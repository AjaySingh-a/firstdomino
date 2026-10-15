"""Against a real FalkorDB (FALKORDB_HOST/PORT, default localhost:6379; `make up` starts one).
Each test uses its own throwaway kb + family graphs and deletes them afterwards."""

import json
import uuid

import pytest
from fastapi.testclient import TestClient

import api.main
from api.graph_store import GraphStore
from api.store import FixtureStore, load_patterns, load_stories
from engine.db import connect, family_graph, props, run
from engine.loaders.seed import seed

STORIES = load_stories()
PATTERNS = list(load_patterns().values())
P1_FINDING = "syn-p1:fnd-ccb-edema-loop-1"
P2_FINDING = "syn-p2:fnd-ccb-edema-loop-1"


@pytest.fixture(scope="module")
def db():
    try:
        conn = connect()
        conn.connection.ping()
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"FalkorDB not reachable: {exc}")
    return conn


@pytest.fixture
def family(db):
    """Yields a seeding function bound to throwaway graph names, then drops them."""
    tag = uuid.uuid4().hex[:8]
    fam_id, kb = f"test_{tag}", f"kb_test_{tag}"

    def load(*stories, reset=False):
        return seed(db, fam_id, list(stories), PATTERNS, reset=reset, kb_name=kb)

    load.family_id = fam_id
    yield load
    for name in (kb, family_graph(fam_id)):
        if name in db.list_graphs():
            db.select_graph(name).delete()


def store_for(db, family) -> GraphStore:
    return GraphStore(db, FixtureStore(STORIES, {p.id: p for p in PATTERNS}), family.family_id, [])


def story1(**obs_over):
    s = STORIES["syn-p1"].model_copy(deep=True)
    for k, v in obs_over.items():
        setattr(s.observations[0], k, v)
    return s


def counts(graph):
    return sorted((r["kind"], r["name"], r["n"]) for r in run(graph, "admin/graph_counts"))


# ---------- Story 1 end to end ----------


def test_story1_end_to_end(db, family):
    g = family(story1())
    rows = run(g, "q6_patient_findings", pid="syn-p1")
    assert [(props(r["f"])["id"], props(r["f"])["status"]) for r in rows] == [(P1_FINDING, "needs_evidence")]

    rev = run(g, "q5_review_history", pid="syn-p1", fid=P1_FINDING)
    assert [(props(r["rev"])["n"], props(r["rev"])["status"]) for r in rev] == [(1, "needs_evidence")]

    inv = store_for(db, family).investigation(P1_FINDING)
    assert [(u.fact_id, u.field) for u in inv.unknowns] == [("syn-p1:ep-furosemide", "indication")]
    assert inv.next_question.id == "syn-p1:q-furosemide-indication"
    assert inv.finding.cited_source_ids == [
        "syn-p1:src-cardio-d0", "syn-p1:src-pharm-d35", "syn-p1:src-cg-d60",
    ]
    assert inv.pattern.window_days == 90 and inv.pattern.evidence_refs[0].doi
    trace = {q.query: q for q in inv.query_trace}
    assert set(trace) == {"q4_evidence_pack", "q2_next_question", "q5_review_history"}
    assert all(q.mode == "live" for q in inv.query_trace)
    assert trace["q2_next_question"].result_ids == ["syn-p1:req-furosemide-indication"]
    assert set(trace["q4_evidence_pack"].result_ids) == {
        "syn-p1:ep-amlodipine", "syn-p1:ep-furosemide", "syn-p1:obs-ankle-swelling",
    }


def test_routes_in_graph_mode(db, family, monkeypatch):
    family(story1())
    monkeypatch.setattr(api.main, "store", store_for(db, family))
    with TestClient(api.main.app) as c:
        assert c.get("/health").json() == {"status": "ok", "mode": "graph", "falkordb": "up"}
        f = c.get("/patients/syn-p1/findings").json()
        assert [x["status"] for x in f["findings"]] == ["needs_evidence"]
        inv = c.get(f"/findings/{P1_FINDING}/investigation").json()
        assert [q["query"] for q in inv["query_trace"]] == [
            "q4_evidence_pack", "q2_next_question", "q5_review_history",
        ]
        assert c.get("/patients/syn-p2/findings").status_code == 404  # not in this family graph
        r = c.post(f"/findings/{P1_FINDING}/review", json={
            "case_version": 2, "revision_n": 1, "by_role": "pharmacist", "decision": "defer", "reason": "x",
        })
        assert r.status_code == 501


# ---------- required checks ----------


def test_unknown_onset_stays_unknown_in_the_graph(db, family):
    g = family(story1(happened_at=None, state="unknown"))
    obs = [r for r in run(g, "q1_candidate_match", pid="syn-p1")][0]["observations"]
    assert obs == [["syn-p1:obs-ankle-swelling", None, "unknown", "Ankle swelling"]]  # null, not 0

    inv = store_for(db, family).investigation(P1_FINDING)
    assert inv.finding.status == "needs_evidence"
    onset = [u for u in inv.unknowns if u.fact_id == "syn-p1:obs-ankle-swelling"]
    assert len(onset) == 1
    assert (onset[0].value, onset[0].state) == (None, "unknown")
    assert onset[0].requirement_id == "syn-p1:req-ankle-swelling-onset_day"
    assert not any(d.fact_id == "syn-p1:obs-ankle-swelling" for d in inv.documented)


def test_reverse_chronology_is_not_matched(db, family):
    s = story1()
    s.episodes[0].happened_at = 40  # amlodipine documented after furosemide (day 35)
    family(s)
    store = store_for(db, family)
    (finding,) = store.findings("syn-p1").findings
    assert finding.status == "not_matched"
    assert finding.requirement_ids == []
    assert store.packet("syn-p1").items == []  # not_matched never reaches the packet


def test_two_patients_in_one_family_graph_never_cross(db, family):
    g = family(STORIES["syn-p1"], STORIES["syn-p2"])
    store = store_for(db, family)
    assert [p.id for p in store.patients()] == ["syn-p1", "syn-p2"]

    for pid, other in (("syn-p1", "syn-p2"), ("syn-p2", "syn-p1")):
        q1 = run(g, "q1_candidate_match", pid=pid)
        assert len(q1) == 1 and other not in json.dumps(q1)
        findings = store.findings(pid)
        assert len(findings.findings) == 1
        assert other not in findings.model_dump_json()
        fid = findings.findings[0].id
        assert other not in store.investigation(fid).model_dump_json()
        assert other not in store.packet(pid).model_dump_json()

    assert store.findings("syn-p1").findings[0].status == "needs_evidence"
    assert store.findings("syn-p2").findings[0].status == "competing_explanation"
    # Asking for p2's finding through p1's anchor returns nothing.
    assert run(g, "q4_evidence_pack", pid="syn-p1", fid=P2_FINDING) == []
    assert run(g, "q5_review_history", pid="syn-p1", fid=P2_FINDING) == []


def test_loading_twice_is_idempotent(db, family):
    g = family(STORIES["syn-p1"], STORIES["syn-p2"])
    first = counts(g)
    before = store_for(db, family).findings("syn-p1").model_dump()
    g = family(STORIES["syn-p1"], STORIES["syn-p2"])  # family graph exists now: MERGE path, not COPY
    assert counts(g) == first
    assert store_for(db, family).findings("syn-p1").model_dump() == before
    g = family(STORIES["syn-p1"], STORIES["syn-p2"], reset=True)  # reset + copy gives the same graph
    assert counts(g) == first
