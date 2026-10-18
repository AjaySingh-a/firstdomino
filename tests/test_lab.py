"""The patient lab: a visitor-built synthetic patient is evaluated by the same rules, on FalkorDB only."""

import uuid

import pytest
from fastapi.testclient import TestClient

from api import lab
from api.graph_store import GraphStore
from api.main import app
from api.models import LabRequest
from api.store import FixtureStore, Invalid, load_patterns, load_stories
from engine.db import connect, family_graph, run
from engine.loaders.seed import seed

PATTERNS = list(load_patterns().values())


def med(name, day, state="documented", reason=None, reason_state="unknown"):
    return {
        "name": name, "start_day": day, "start_state": state, "reason": reason, "reason_state": reason_state,
    }


def req(*meds, onset=20, onset_state="reported"):
    symptom = None if onset is False else {"onset_day": onset, "state": onset_state}
    return LabRequest(medicines=list(meds), symptom=symptom)


# ---------- building the story (no graph) ----------


def test_story_is_synthetic_and_patient_scoped():
    s = lab.build_story(req(med("amlodipine", 0), med("furosemide", 35)), "lab-abc123")
    assert s.synthetic and s.patient.synthetic and s.patient.id == "lab-abc123"
    assert [e.id for e in s.episodes] == ["lab-abc123:ep-amlodipine", "lab-abc123:ep-furosemide"]
    assert s.episodes[0].ingredient.drug_class == "C08CA"
    assert s.observations[0].id == "lab-abc123:obs-ankle-swelling"
    assert s.patient.as_of_day == 42


def test_unknown_day_stays_unknown():
    s = lab.build_story(req(med("amlodipine", 9, state="unknown"), med("furosemide", None)), "lab-x")
    assert [(e.happened_at, e.state) for e in s.episodes] == [(None, "unknown"), (None, "unknown")]


@pytest.mark.parametrize(
    "body",
    [
        req(med("aspirin", 0)),
        req(med("amlodipine", 0), med("amlodipine", 3)),
        req(med("amlodipine", 9999)),
        req(med("furosemide", 3, reason="heart failure")),  # a reason needs a state
    ],
)
def test_invalid_requests(body):
    with pytest.raises(Invalid):
        lab.build_story(body, "lab-x")


def test_palette_classes_match_the_patterns():
    p = lab.palette()
    classes = {m.drug_class for m in p.medicines}
    for pattern in p.patterns:
        assert pattern.index_class in classes and pattern.marker_class in classes


def test_without_the_graph_the_lab_answers_503():
    with TestClient(app) as c:  # the test app runs on fixtures
        r = c.post("/lab/patients", json=req(med("amlodipine", 0), med("furosemide", 35)).model_dump())
    assert r.status_code == 503 and r.json()["error"] == "graph_required"


# ---------- on FalkorDB ----------


@pytest.fixture
def store():
    try:
        db = connect()
        db.connection.ping()
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"FalkorDB not reachable: {exc}")
    tag = uuid.uuid4().hex[:8]
    fam, kb = f"test_{tag}", f"kb_test_{tag}"
    seed(db, fam, [], PATTERNS, kb_name=kb)
    yield GraphStore(db, FixtureStore(load_stories(), {p.id: p for p in PATTERNS}), fam, [])
    for name in (kb, family_graph(fam)):
        if name in db.list_graphs():
            db.select_graph(name).delete()


def statuses(store, body):
    out = store.create_lab_patient(lab.build_story(body, lab.new_patient_id()))
    return [f.status for f in out.findings], out


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (req(med("nifedipine", 0), med("bumetanide", 40)), ["needs_evidence"]),  # reason unknown
        (req(med("amlodipine", 0), med("furosemide", 40, reason="ankle swelling", reason_state="reported")),
         ["candidate"]),
        (req(med("amlodipine", 0), med("furosemide", 40, reason="heart failure", reason_state="documented")),
         ["competing_explanation"]),
        (req(med("amlodipine", 30), med("furosemide", 5), onset_state="documented"), ["not_matched"]),
        (req(med("diltiazem", 0), med("furosemide", 40)), []),  # not the pattern's class
        (req(med("amlodipine", 0), med("hydrochlorothiazide", 40)), []),  # not a loop diuretic
    ],
)
def test_same_rules_decide_lab_patients(store, body, expected):
    assert statuses(store, body)[0] == expected


def test_lab_patient_works_with_every_read_and_is_timed(store):
    found, out = statuses(store, req(med("amlodipine", 0), med("furosemide", 35), med("atorvastatin", 2)))
    pid = out.patient.id
    assert found == ["needs_evidence"] and pid.startswith("lab-")
    assert [s.name for s in out.steps][-1] == "q6_patient_findings" and all(s.ms >= 0 for s in out.steps)
    assert store.affected(pid, f"{pid}:ep-atorvastatin").findings == []
    assert store.investigation(out.findings[0].id).finding.id == out.findings[0].id


def test_oldest_lab_patients_are_dropped(store, monkeypatch):
    monkeypatch.setattr(GraphStore, "LAB_KEEP", 2)
    ids = [statuses(store, req(med("amlodipine", 0)))[1].patient.id for _ in range(3)]
    g = store.db.select_graph(family_graph(store.family_id))
    present = {r["p"].properties["id"] for r in run(g, "admin/patients_in_graph")}
    assert present == set(ids[1:])
