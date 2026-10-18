"""Against a real FalkorDB (FALKORDB_HOST/PORT, default localhost:6379; `make up` starts one).
Each test uses its own throwaway kb + family graphs and deletes them afterwards."""

import json
import os
import threading
import uuid

import pytest
from fastapi.testclient import TestClient

import api.graph_store
import api.main
from api.graph_store import GraphStore
from api.models import (
    AgentStepRequest,
    EvidenceRequest,
    Ingredient,
    MedicationEpisode,
    QuestionRequest,
    ReviewRequest,
)
from api.store import Conflict, FixtureStore, Invalid, NotFound, load_patterns, load_stories
from engine.db import connect, family_graph, props, run
from engine.loaders.seed import seed

STORIES = load_stories()
PATTERNS = list(load_patterns().values())
P1_FINDING = "syn-p1:fnd-ccb-edema-loop-1"
P2_FINDING = "syn-p2:fnd-ccb-edema-loop-1"
P3_FINDING = "syn-p3:fnd-ccb-edema-loop-1"
P3_OBS = "syn-p3:obs-ankle-swelling"
P3_EVENT = STORIES["syn-p3"].pending_evidence[0]  # onset 28 (reported) -> 14 (documented, GP note)


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

    rev = run(g, "q5_history", pid="syn-p1", fid=P1_FINDING)
    assert [(props(r["rev"])["n"], props(r["rev"])["status"]) for r in rev] == [(1, "needs_evidence")]

    inv = store_for(db, family).investigation(P1_FINDING)
    assert [(u.fact_id, u.field) for u in inv.unknowns] == [("syn-p1:ep-furosemide", "indication")]
    assert inv.next_question.id == "syn-p1:q-furosemide-indication"
    assert inv.finding.cited_source_ids == [
        "syn-p1:src-cardio-d0", "syn-p1:src-pharm-d35", "syn-p1:src-cg-d60",
    ]
    assert inv.pattern.window_days == 90 and inv.pattern.evidence_refs[0].doi
    trace = {q.query: q for q in inv.query_trace}
    assert set(trace) == {"q4_evidence_pack", "q2_next_question", "q5_history"}
    assert all(q.mode == "live" for q in inv.query_trace)
    assert trace["q2_next_question"].result_ids == ["syn-p1:req-furosemide-indication"]
    assert set(trace["q4_evidence_pack"].result_ids) == {
        "syn-p1:ep-amlodipine", "syn-p1:ep-furosemide", "syn-p1:obs-ankle-swelling",
    }


def test_story1_path_is_the_graphs_own(db, family):
    """q11 returns the walk as FalkorDB's path, in walk order, with each edge's direction."""
    family(STORIES["syn-p1"])
    p = store_for(db, family).finding_path(P1_FINDING)
    assert p.mode == "live"
    assert [(n.label, n.id or n.name) for n in p.walk.nodes] == [
        ("MedicationEpisode", "syn-p1:ep-amlodipine"), ("Ingredient", "amlodipine"), ("DrugClass", "C08CA"),
        ("Pattern", "pat-ccb-edema-loop"), ("DrugClass", "C03CA"), ("Ingredient", "furosemide"),
        ("MedicationEpisode", "syn-p1:ep-furosemide"),
    ]
    assert [(e.type, e.forward) for e in p.walk.edges] == [
        ("OF", True), ("IN_CLASS", True), ("INDEX", False), ("MARKER", True),
        ("IN_CLASS", False), ("OF", False),
    ]
    [side] = p.sides
    assert [(n.label, n.id or n.name) for n in side.nodes] == [
        ("Pattern", "pat-ccb-edema-loop"), ("Effect", "peripheral_edema"),
        ("Observation", "syn-p1:obs-ankle-swelling"),
    ]
    assert [q.query for q in p.query_trace] == ["q11_finding_path"] and p.query_trace[0].ms is not None
    # The fixture store returns the same shape for the same story, labelled as fixture mode.
    fx = FixtureStore(STORIES, {pat.id: pat for pat in PATTERNS}).finding_path(P1_FINDING)
    assert fx.mode == "fixture" and fx.walk == p.walk and fx.sides == p.sides


def test_routes_in_graph_mode(db, family, monkeypatch):
    family(story1())
    monkeypatch.setattr(api.main, "store", store_for(db, family))
    with TestClient(api.main.app) as c:
        health = c.get("/health").json()
        aof = health.pop("appendonly")
        assert health == {"status": "ok", "mode": "graph", "falkordb": "up"}
        # Compose runs FalkorDB with AOF on and sets FD_EXPECT_AOF=1; a plain `docker run` one has it off.
        assert aof in (("yes",) if os.environ.get("FD_EXPECT_AOF") == "1" else ("yes", "no"))
        f = c.get("/patients/syn-p1/findings").json()
        assert [x["status"] for x in f["findings"]] == ["needs_evidence"]
        inv = c.get(f"/findings/{P1_FINDING}/investigation").json()
        assert [q["query"] for q in inv["query_trace"]] == [
            "q4_evidence_pack", "q2_next_question", "q5_history",
        ]
        assert c.get("/patients/syn-p2/findings").status_code == 404  # not in this family graph
        t = c.get("/patients/syn-p1/timeline").json()
        assert [e["id"] for e in t["episodes"]] == ["syn-p1:ep-amlodipine", "syn-p1:ep-furosemide"]
        review = {
            "case_version": 2, "revision_n": 1, "by_role": "pharmacist", "decision": "defer", "reason": "x",
        }
        r = c.post(f"/findings/{P1_FINDING}/review", json=review)
        assert r.status_code == 200 and r.json()["case_version"] == 3
        stale = c.post(f"/findings/{P1_FINDING}/review", json=review)
        assert stale.status_code == 409
        assert stale.json() == {
            "error": "stale_case_version", "patient_id": "syn-p1", "sent": 2, "current": 3,
        }
        body = {"event_id": "syn-p1:evt-x", "case_version": 3, "change": {
            "fact_id": "syn-p1:ep-furosemide", "field": "indication", "state": "not_available"}}
        r = c.post("/patients/syn-p1/evidence", json=body)
        assert r.status_code == 200 and r.json()["new_revisions"][0]["status"] == "needs_reassessment"
        assert c.post("/patients/syn-p1/evidence", json=body).json()["replayed"] is True


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
    assert run(g, "q5_history", pid="syn-p1", fid=P2_FINDING) == []


def test_loading_twice_is_idempotent(db, family):
    g = family(STORIES["syn-p1"], STORIES["syn-p2"])
    first = counts(g)
    before = store_for(db, family).findings("syn-p1").model_dump()
    g = family(STORIES["syn-p1"], STORIES["syn-p2"])  # family graph exists now: MERGE path, not COPY
    assert counts(g) == first
    assert store_for(db, family).findings("syn-p1").model_dump() == before
    g = family(STORIES["syn-p1"], STORIES["syn-p2"], reset=True)  # reset + copy gives the same graph
    assert counts(g) == first


# ---------- D-2: timeline, evidence, review memory ----------


def evidence(pid, n, case_version, fact_id, field, value=None, state="documented", source_id=None):
    return EvidenceRequest.model_validate({
        "event_id": f"{pid}:evt-{n}", "case_version": case_version,
        "change": {
            "fact_id": fact_id, "field": field, "value": value, "state": state, "source_id": source_id,
        },
    })


def review(case_version, revision_n, reason="Possible pattern noted."):
    return ReviewRequest(
        case_version=case_version, revision_n=revision_n, by_role="clinician", decision="follow_up",
        reason=reason,
    )


def versions(g, fact_id):
    out = []
    for r in run(g, "admin/fact_versions", fact_id=fact_id):
        v = props(r["v"])
        out.append((v["n"], v.get("happened_at"), v["state"], v["recorded_at"], v.get("superseded_at"),
                    r["supersedes"]))
    return out


def requirement_states(g, pid):
    return {r["id"]: r["state"] for r in run(g, "admin/requirement_states", pid=pid)}


def by_source_day(t):
    day = {s.id: (s.happened_at if s.happened_at is not None else s.recorded_at, s.id) for s in t.sources}
    return lambda sid: day[sid]


def test_timeline_is_served_from_the_graph(db, family):
    g = family(*STORIES.values())
    # No fixture stories behind this store: every timeline below comes from FalkorDB.
    store = GraphStore(db, FixtureStore({}, {p.id: p for p in PATTERNS}), family.family_id, [])
    for pid, story in STORIES.items():
        t = store.timeline(pid)
        assert t.patient == story.patient
        assert sorted(t.sources, key=lambda s: s.id) == sorted(story.sources, key=lambda s: s.id)
        for got, want in ((t.episodes, story.episodes), (t.observations, story.observations)):
            assert got == [
                x.model_copy(update={"source_ids": sorted(x.source_ids, key=by_source_day(t))})
                for x in sorted(want, key=lambda x: x.id)
            ]
        assert t.pending_evidence == story.pending_evidence
    # A confirmed change shows up on the timeline, and the event is no longer pending.
    store.submit_evidence("syn-p3", P3_EVENT)
    t = store.timeline("syn-p3")
    obs = t.observations[0]
    assert (obs.happened_at, obs.state, obs.recorded_at) == (14, "documented", 62)
    assert obs.source_ids == ["syn-p3:src-gp-note-d14", "syn-p3:src-cg-d45"]
    assert t.pending_evidence == [] and t.patient.case_version == 5
    assert versions(g, P3_OBS)[-1][0] == 2


def test_story3_history_is_seeded(db, family):
    family(STORIES["syn-p3"])
    store = store_for(db, family)
    (f,) = store.findings("syn-p3").findings
    assert (f.status, f.revision_n) == ("reviewed", 1)
    inv = store.investigation(P3_FINDING)
    assert [(r.n, r.status, r.created_at) for r in inv.revisions] == [(1, "candidate", 45)]
    assert [(d.id, d.revision_n) for d in inv.decisions] == [(f"{P3_FINDING}:rev-1:dec-1", 1)]
    assert inv.case_version == 4


def test_correction_appends_a_version_and_reassesses_the_reviewed_finding(db, family):
    g = family(STORIES["syn-p3"])
    store = store_for(db, family)
    res = store.submit_evidence("syn-p3", P3_EVENT)

    assert (res.case_version_before, res.case_version, res.replayed) == (4, 5, False)
    assert (res.before["happened_at"], res.before["state"]) == (28, "reported")
    assert (res.after["happened_at"], res.after["state"], res.after["recorded_at"]) == (14, "documented", 62)
    # The old version is kept; the new one supersedes it.
    assert versions(g, P3_OBS) == [(1, 28, "reported", 45, 62, None), (2, 14, "documented", 62, None, 1)]

    assert res.affected_finding_ids == [P3_FINDING]
    (rev,) = res.new_revisions
    assert (rev.id, rev.n, rev.previous_n, rev.status) == (f"{P3_FINDING}:rev-2", 2, 1, "needs_reassessment")
    assert rev.changed_fact_ids == [P3_OBS] and rev.created_at == 62
    assert rev.reason.startswith("Ankle swelling: happened_at changed from 28 (reported) to 14 (documented).")
    assert "Revision 1 was reviewed" in rev.reason
    (chg,) = res.finding_changes
    assert (chg.before.status, chg.before.revision_n) == ("reviewed", 1)
    assert (chg.after.status, chg.after.revision_n) == ("needs_reassessment", 2)

    # The decision stays on revision 1; Q5 returns the whole chain and the event behind revision 2.
    q5 = run(g, "q5_history", pid="syn-p3", fid=P3_FINDING)
    assert [(props(r["rev"])["n"], r["previous_n"], len(r["decisions"]), r["event_ids"]) for r in q5] == [
        (1, None, 1, []), (2, 1, 0, [P3_EVENT.event_id]),
    ]
    inv = store.investigation(P3_FINDING)
    assert inv.finding.status == "needs_reassessment" and inv.case_version == 5
    assert [d.revision_n for d in inv.decisions] == [1]


def test_review_goes_on_the_current_revision_and_survives_later_evidence(db, family):
    family(story1())
    store = store_for(db, family)
    r = store.review(P1_FINDING, review(2, 1, "Waiting for the furosemide reason."))
    assert r.case_version == 3 and r.finding.status == "reviewed"
    d = r.decision
    assert (d.id, d.revision_n, d.decided_at) == (f"{P1_FINDING}:rev-1:dec-1", 1, 60)

    with pytest.raises(Conflict) as stale:
        store.review(P1_FINDING, review(2, 1))
    assert stale.value.body == {
        "error": "stale_case_version", "patient_id": "syn-p1", "sent": 2, "current": 3,
    }
    with pytest.raises(Conflict) as stale:
        store.review(P1_FINDING, review(3, 0))
    assert stale.value.body["error"] == "stale_revision"
    with pytest.raises(NotFound):
        store.review("syn-p1:fnd-nothing-1", review(3, 1))

    res = store.submit_evidence("syn-p1", evidence(
        "syn-p1", "ind", 3, "syn-p1:ep-furosemide", "indication", "ankle swelling", "documented",
        "syn-p1:src-pharm-d35",
    ))
    assert res.new_revisions[0].status == "needs_reassessment"
    r2 = store.review(P1_FINDING, review(4, 2))
    assert r2.decision.id == f"{P1_FINDING}:rev-2:dec-1"
    inv = store.investigation(P1_FINDING)
    assert [(d.revision_n, d.reason) for d in inv.decisions] == [
        (1, "Waiting for the furosemide reason."), (2, "Possible pattern noted."),
    ]
    assert [(rv.n, rv.previous_n) for rv in inv.revisions] == [(1, None), (2, 1)]


def test_an_answer_re_runs_the_rules_for_an_unreviewed_finding(db, family):
    g = family(story1())
    store = store_for(db, family)
    assert requirement_states(g, "syn-p1") == {"syn-p1:req-furosemide-indication": "missing"}
    res = store.submit_evidence("syn-p1", evidence(
        "syn-p1", "ind", 2, "syn-p1:ep-furosemide", "indication", "ankle swelling", "documented",
        "syn-p1:src-pharm-d35",
    ))
    (rev,) = res.new_revisions
    assert (rev.n, rev.status) == (2, "candidate")
    assert rev.reason.startswith(
        "furosemide: indication changed from not recorded (unknown) to ankle swelling (documented). "
        "Re-evaluated."
    )
    (chg,) = res.finding_changes
    assert (chg.before.status, chg.after.status) == ("needs_evidence", "candidate")
    assert res.pending_reevaluation_ids == []
    assert requirement_states(g, "syn-p1") == {"syn-p1:req-furosemide-indication": "provided"}
    inv = store.investigation(P1_FINDING)
    assert inv.next_question is None and inv.unknowns == []


def test_correction_then_retraction_keeps_every_version(db, family):
    g = family(STORIES["syn-p3"])
    store = store_for(db, family)
    store.submit_evidence("syn-p3", P3_EVENT)
    retract = evidence("syn-p3", "retract", 5, P3_OBS, "happened_at", None, "unknown")
    res = store.submit_evidence("syn-p3", retract)
    assert res.after["happened_at"] is None and res.after["state"] == "unknown"
    assert versions(g, P3_OBS) == [
        (1, 28, "reported", 45, 62, None),
        (2, 14, "documented", 62, 62, 1),
        (3, None, "unknown", 62, None, 2),
    ]
    (rev,) = res.new_revisions
    assert (rev.n, rev.previous_n, rev.status) == (3, 2, "needs_reassessment")
    # The onset is not known any more: that is a gap to ask about, never a "no".
    assert requirement_states(g, "syn-p3") == {"syn-p3:req-ankle-swelling-onset_day": "missing"}
    inv = store.investigation(P3_FINDING)
    assert inv.next_question.requirement_id == "syn-p3:req-ankle-swelling-onset_day"
    assert [(u.fact_id, u.value, u.state) for u in inv.unknowns] == [(P3_OBS, None, "unknown")]
    assert [r.n for r in inv.revisions] == [1, 2, 3] and [d.revision_n for d in inv.decisions] == [1]


def test_not_available_is_never_a_no(db, family):
    g = family(story1())
    store = store_for(db, family)
    res = store.submit_evidence("syn-p1", evidence(
        "syn-p1", "na", 2, "syn-p1:ep-furosemide", "indication", state="not_available",
    ))
    assert (res.after["indication"], res.after["indication_state"]) == (None, "not_available")
    assert requirement_states(g, "syn-p1") == {"syn-p1:req-furosemide-indication": "not_available"}
    assert res.new_revisions[0].status == "needs_evidence"  # still a gap: not a match, not a "no"
    inv = store.investigation(P1_FINDING)
    (gap,) = inv.unknowns
    assert (gap.field, gap.value, gap.state) == ("indication", None, "not_available")
    assert gap.requirement_id == "syn-p1:req-furosemide-indication"
    assert inv.next_question is None  # not asked again


def test_not_available_onset_stays_not_available_after_re_evaluation(db, family):
    g = family(story1(happened_at=None, state="unknown"))
    store = store_for(db, family)
    req = "syn-p1:req-ankle-swelling-onset_day"
    assert requirement_states(g, "syn-p1")[req] == "missing"
    res = store.submit_evidence("syn-p1", evidence(
        "syn-p1", "na", 2, "syn-p1:obs-ankle-swelling", "happened_at", state="not_available",
    ))
    assert (res.after["happened_at"], res.after["state"]) == (None, "unknown")
    assert requirement_states(g, "syn-p1")[req] == "not_available"  # the rules still see a gap


def test_an_unrelated_change_reopens_nothing(db, family):
    s = STORIES["syn-p3"].model_copy(deep=True)
    s.episodes.append(MedicationEpisode(
        id="syn-p3:ep-omeprazole", patient_id="syn-p3", happened_at=10, recorded_at=10, state="documented",
        source_ids=["syn-p3:src-pharm-d40"],
        ingredient=Ingredient(name="omeprazole", rxcui="7646", drug_class="A02BC"),
        dose_text="20 mg once daily", indication="indigestion", indication_state="documented",
        stop_day=None, prescriber_specialty="general_practice",
    ))
    g = family(s)
    store = store_for(db, family)
    findings_before = store.findings("syn-p3").findings
    history_before = run(g, "q5_history", pid="syn-p3", fid=P3_FINDING)

    stop = evidence("syn-p3", "omep", 4, "syn-p3:ep-omeprazole", "stop_day", 50)
    res = store.submit_evidence("syn-p3", stop)
    assert res.case_version == 5
    assert (res.affected_finding_ids, res.new_revisions, res.finding_changes) == ([], [], [])
    assert store.findings("syn-p3").findings == findings_before  # still reviewed, still revision 1
    assert run(g, "q5_history", pid="syn-p3", fid=P3_FINDING) == history_before


def test_duplicate_event_is_a_no_op(db, family):
    g = family(STORIES["syn-p3"])
    store = store_for(db, family)
    first = store.submit_evidence("syn-p3", P3_EVENT)
    after_first = counts(g)
    again = store.submit_evidence("syn-p3", P3_EVENT)  # its case_version (4) is stale now: still a replay
    assert again.replayed is True
    assert again.model_copy(update={"replayed": False}) == first
    assert counts(g) == after_first
    assert store.timeline("syn-p3").patient.case_version == 5


def test_stale_case_version_is_409_and_writes_nothing(db, family):
    g = family(STORIES["syn-p3"])
    store = store_for(db, family)
    before = counts(g)
    with pytest.raises(Conflict) as stale:
        store.submit_evidence("syn-p3", P3_EVENT.model_copy(update={"case_version": 3}))
    assert stale.value.body == {
        "error": "stale_case_version", "patient_id": "syn-p3", "sent": 3, "current": 4,
    }
    assert counts(g) == before

    # The check that matters is the compare-and-set inside FalkorDB, not a read in Python.
    stale_apply = run(
        g, "write/evidence_apply", pid="syn-p3", fact_id=P3_OBS, case_version=3,
        fact_props={"happened_at": 1},
        old_id=f"{P3_OBS}:ver-1", old_props={}, new_props={}, recorded_at=62,
        event_id="syn-p3:evt-raw", event_props={},
    )
    assert stale_apply == [] and counts(g) == before


def test_concurrent_writes_on_one_version_let_exactly_one_through(db, family):
    family(STORIES["syn-p3"])
    stores = [store_for(db, family), store_for(db, family)]  # two API processes
    reqs = [P3_EVENT, evidence("syn-p3", "other", 4, "syn-p3:ep-furosemide", "stop_day", 61)]
    barrier, outcomes = threading.Barrier(2), []

    def send(store, req):
        barrier.wait()
        try:
            outcomes.append(store.submit_evidence("syn-p3", req).case_version)
        except Conflict as exc:
            outcomes.append(exc.body["error"])

    threads = [threading.Thread(target=send, args=pair) for pair in zip(stores, reqs, strict=True)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes, key=str) == [5, "stale_case_version"]
    assert stores[0].timeline("syn-p3").patient.case_version == 5


def test_state_survives_an_api_restart(db, family):
    family(STORIES["syn-p3"])
    store = store_for(db, family)
    first = store.submit_evidence("syn-p3", P3_EVENT)
    store.review(P3_FINDING, review(5, 2))
    seen = (store.timeline("syn-p3"), store.findings("syn-p3"), store.investigation(P3_FINDING))

    family(STORIES["syn-p3"])  # a restart seeds again: a patient already in the graph is never reloaded
    fresh = store_for(db, family)  # a new process: nothing in memory
    assert (fresh.timeline("syn-p3"), fresh.findings("syn-p3"), fresh.investigation(P3_FINDING)) == seen
    assert fresh.submit_evidence("syn-p3", P3_EVENT) == first.model_copy(update={"replayed": True})


def test_writes_never_cross_patients(db, family):
    g = family(STORIES["syn-p1"], STORIES["syn-p2"])
    store = store_for(db, family)

    def p2():
        return (store.timeline("syn-p2"), store.findings("syn-p2"), store.investigation(P2_FINDING),
                requirement_states(g, "syn-p2"))

    p2_before = p2()
    with pytest.raises(NotFound):  # a p2 fact through the p1 anchor
        store.submit_evidence("syn-p1", evidence("syn-p1", "x", 2, "syn-p2:ep-furosemide", "stop_day", 50))
    with pytest.raises(Invalid):  # a p2 event id sent to p1
        store.submit_evidence("syn-p1", evidence("syn-p2", "x", 2, "syn-p1:ep-furosemide", "stop_day", 50))
    with pytest.raises(Invalid):  # a p2 source on a p1 fact
        store.submit_evidence("syn-p1", evidence(
            "syn-p1", "x", 2, "syn-p1:ep-furosemide", "stop_day", 50, source_id="syn-p2:src-cardio-d0",
        ))
    # The queries themselves find nothing across the anchor.
    assert run(g, "q3_affected", pid="syn-p1", fact_id="syn-p2:ep-furosemide") == []
    assert run(
        g, "write/evidence_apply", pid="syn-p1", fact_id="syn-p2:ep-furosemide", case_version=2,
        fact_props={"stop_day": 1}, old_id="x", old_props={}, new_props={}, recorded_at=0,
        event_id="syn-p1:evt-raw", event_props={},
    ) == []
    assert run(
        g, "write/review", pid="syn-p1", fid=P2_FINDING, case_version=2, revision_n=1, by_role="clinician",
        decision="defer", reason="x", decided_at=0,
    ) == []

    # A real change and a review on p1 leave p2 exactly as it was.
    store.submit_evidence("syn-p1", evidence(
        "syn-p1", "ind", 2, "syn-p1:ep-furosemide", "indication", state="not_available",
    ))
    store.review(P1_FINDING, review(3, 2))
    assert p2() == p2_before
    assert "syn-p2" not in store.investigation(P1_FINDING).model_dump_json()
    assert run(g, "q5_history", pid="syn-p1", fid=P2_FINDING) == []


# ---------- D-3: resuming an event stuck in 'applying', questions, agent steps ----------


def event_status(g, pid, event_id):
    (row,) = run(g, "q8_evidence_event", pid=pid, event_id=event_id)
    return props(row["e"])["status"]


@pytest.mark.parametrize("crash_at", ["re-evaluation", "evidence_done"])
def test_a_resent_event_stuck_in_applying_resumes(db, family, monkeypatch, crash_at):
    """The API stopped after the fact was applied (case_version already moved). Re-sending the same
    event_id finishes the re-evaluation and revision writes instead of answering 409."""
    g = family(STORIES["syn-p3"])
    store = store_for(db, family)
    real_run, real_reevaluate = api.graph_store.run, api.graph_store.reevaluate

    def crash(*a, **k):
        raise RuntimeError("API stopped")

    if crash_at == "re-evaluation":
        monkeypatch.setattr(api.graph_store, "reevaluate", crash)
    else:  # the revision is written; only the event's result is missing
        def run_until_done(g_, q, **p):
            return crash() if q == "write/evidence_done" else real_run(g_, q, **p)

        monkeypatch.setattr(api.graph_store, "run", run_until_done)
    with pytest.raises(RuntimeError):
        store.submit_evidence("syn-p3", P3_EVENT)
    monkeypatch.setattr(api.graph_store, "run", real_run)
    monkeypatch.setattr(api.graph_store, "reevaluate", real_reevaluate)

    assert event_status(g, "syn-p3", P3_EVENT.event_id) == "applying"
    assert store.timeline("syn-p3").patient.case_version == 5  # the sent case_version (4) is stale now
    res = store.submit_evidence("syn-p3", P3_EVENT)
    assert (res.case_version_before, res.case_version, res.replayed) == (4, 5, False)
    assert [(r.n, r.previous_n, r.status) for r in res.new_revisions] == [(2, 1, "needs_reassessment")]
    assert (res.before["happened_at"], res.after["happened_at"]) == (28, 14)
    assert event_status(g, "syn-p3", P3_EVENT.event_id) == "applied"
    inv = store.investigation(P3_FINDING)
    assert [r.n for r in inv.revisions] == [1, 2] and [d.revision_n for d in inv.decisions] == [1]
    assert versions(g, P3_OBS)[-1][:3] == (2, 14, "documented")  # applied once, not twice
    assert store.submit_evidence("syn-p3", P3_EVENT) == res.model_copy(update={"replayed": True})


def test_a_question_is_asked_once_and_stays_until_answered(db, family):
    g = family(story1())
    store = store_for(db, family)
    rid = "syn-p1:req-furosemide-indication"
    with pytest.raises(Conflict):
        store.ask_question(QuestionRequest(case_version=1, requirement_id=rid))
    with pytest.raises(Invalid):
        store.ask_question(QuestionRequest(case_version=2, requirement_id=rid, text="Is it safe to stop?"))
    with pytest.raises(NotFound):
        store.ask_question(QuestionRequest(case_version=2, requirement_id="syn-p1:req-nothing"))
    assert store.timeline("syn-p1").patient.case_version == 2  # none of those wrote anything

    res = store.ask_question(QuestionRequest(case_version=2, requirement_id=rid))
    q = res.question
    assert (res.case_version, res.replayed) == (3, False)
    assert (q.id, q.requirement_id, q.ask_role, q.asked_at) == (
        "syn-p1:q-furosemide-indication", rid, "caregiver", 60,
    )
    assert q.text.startswith("Do you know why furosemide was started around day 35?")
    assert run(g, "q2_next_question", pid="syn-p1") == []  # asked: not the next one to ask
    inv = store.investigation(P1_FINDING)
    assert inv.next_question == q  # still shown until it is answered
    assert inv.query_trace[-1].query == "q9_requirements"
    again = store.ask_question(QuestionRequest(case_version=2, requirement_id=rid, text="other"))
    assert (again.replayed, again.question, again.case_version) == (True, q, 3)

    store.submit_evidence("syn-p1", evidence(
        "syn-p1", "ind", 3, "syn-p1:ep-furosemide", "indication", "ankle swelling", "reported",
    ))
    assert store.investigation(P1_FINDING).next_question is None


def test_an_agent_phrased_question_keeps_its_text(db, family):
    family(story1())
    store = store_for(db, family)
    text = "When the water tablet (furosemide) was started around day 35, what was it for?"
    rid = "syn-p1:req-furosemide-indication"
    res = store.ask_question(QuestionRequest(case_version=2, requirement_id=rid, text=text))
    assert res.question.text == text
    assert store.investigation(P1_FINDING).next_question.text == text


def test_a_closed_requirement_is_not_asked(db, family):
    family(story1())
    store = store_for(db, family)
    store.submit_evidence("syn-p1", evidence("syn-p1", "na", 2, "syn-p1:ep-furosemide", "indication",
                                             state="not_available"))
    with pytest.raises(Invalid):  # not_available: never asked again, and never read as "no"
        store.ask_question(QuestionRequest(case_version=3, requirement_id="syn-p1:req-furosemide-indication"))


def test_agent_steps_are_recorded_without_moving_the_case_version(db, family):
    g = family(story1())
    store = store_for(db, family)
    seeded = store.agent_steps("syn-p1")
    assert [(s.id, s.tool, s.finding_id) for s in seeded.steps] == [
        ("syn-p1:step-1", "get_next_question", P1_FINDING),
    ]
    req = AgentStepRequest(
        step_id="syn-p1:step-2", case_version=2, finding_id=P1_FINDING, tool="draft_question_text", ok=True,
        args={"pid": "syn-p1", "requirement_id": "syn-p1:req-furosemide-indication"},
        result_ids=["syn-p1:req-furosemide-indication"],
    )
    res = store.record_agent_step(req)
    assert (res.case_version, res.replayed, res.step.at) == (2, False, 60)
    assert store.timeline("syn-p1").patient.case_version == 2
    assert [s.id for s in store.agent_steps("syn-p1").steps] == ["syn-p1:step-1", "syn-p1:step-2"]
    assert store.agent_steps("syn-p1").steps[1] == res.step
    assert store.record_agent_step(req).replayed is True
    before = counts(g)

    with pytest.raises(Conflict):
        store.record_agent_step(req.model_copy(update={"step_id": "syn-p1:step-3", "case_version": 1}))
    with pytest.raises(Invalid):  # cites another patient's IDs
        store.record_agent_step(req.model_copy(update={"step_id": "syn-p1:step-3",
                                                       "result_ids": ["syn-p2:ep-furosemide"]}))
    with pytest.raises(NotFound):
        store.record_agent_step(req.model_copy(update={"step_id": "syn-p1:step-3",
                                                       "finding_id": "syn-p1:fnd-nothing-1"}))
    assert counts(g) == before
    no_finding = store.record_agent_step(
        req.model_copy(update={"step_id": "syn-p1:step-3", "finding_id": None})
    )
    assert no_finding.step.finding_id is None


# ---------- A-3: the review agent and read-only Q3 on FalkorDB ----------


def test_affected_is_read_only_q3(db, family):
    g = family(STORIES["syn-p3"])
    store = store_for(db, family)
    before = counts(g)
    res = store.affected("syn-p3", P3_OBS)
    assert [f.id for f in res.findings] == [P3_FINDING] and res.findings[0].status == "reviewed"
    assert store.affected("syn-p3", "syn-p3:ep-atorvastatin").findings == []  # the unrelated medicine
    with pytest.raises(NotFound):
        store.affected("syn-p3", "syn-p3:nothing")
    assert counts(g) == before and res.case_version == 4


def test_review_agent_pass_matches_the_fixture_store(db, family):
    from agent.review_agent import run_review_agent

    family(story1())
    graph = run_review_agent(store_for(db, family), P1_FINDING, None)
    fixture = run_review_agent(FixtureStore(STORIES, {p.id: p for p in PATTERNS}), P1_FINDING, None)
    # The wording of a question is the one thing that differs: the graph phrases an unasked question
    # from the template, while the fixture keeps the story's own wording ("the water tablet ...").
    def shape(r):
        return [
            (s.id, s.tool, s.ok, {k: v for k, v in s.args.items() if k != "text"}, sorted(s.result_ids))
            for s in r.steps
        ]

    assert shape(graph) == shape(fixture)
    assert graph.question.model_copy(update={"text": ""}) == fixture.question.model_copy(update={"text": ""})
    assert graph.question.text.startswith("Do you know why") and "furosemide" in graph.question.text
    assert graph.packet_text.startswith(fixture.packet_text.split(" Open question")[0])
    assert graph.case_version == 3  # only the question moved it
    persisted = [s.id for s in store_for(db, family).agent_steps("syn-p1").steps]
    assert persisted == ["syn-p1:step-1", *(f"syn-p1:run-1-step-{k}" for k in range(1, 7))]


def test_second_agent_run_answers_from_memory(db, family):
    """F-3: run 2 does not ask again, and says so, citing run 1's question and step."""
    from agent.review_agent import run_review_agent

    family(story1())
    store = store_for(db, family)
    first = run_review_agent(store, P1_FINDING, None)
    asked = next(s for s in first.steps if s.args["agent_tool"] == "ask_question")
    qid = first.question.id
    second = run_review_agent(store, P1_FINDING, None)
    tools = [s.args["agent_tool"] for s in second.steps]
    assert "ask_question" not in tools and len(second.steps) <= 6
    nxt = next(s for s in second.steps if s.args["agent_tool"] == "next_missing_fact")
    assert nxt.args["outcome"] == "answered from memory"
    assert qid in nxt.result_ids and asked.id in nxt.result_ids
    assert nxt.args["memory"].startswith(f"Asked in run 1 (question {qid}, step {asked.id})")
    assert second.case_version == first.case_version  # memory read, nothing written but agent steps


# ---------- D-4: seeding on a host where GRAPH.COPY cannot fork ----------


def test_seed_loads_knowledge_directly_when_graph_copy_fails(db, family, monkeypatch):
    from redis.exceptions import ResponseError

    def no_fork(self, clone):
        raise ResponseError("could not fork")

    monkeypatch.setattr(type(db.select_graph("x")), "copy", no_fork)
    g = family(story1())
    store = store_for(db, family)
    assert [p.id for p in store.patients()] == ["syn-p1"]
    assert store.findings("syn-p1").findings[0].status == "needs_evidence"  # the rules found the pattern
    kinds = {r[0] for r in counts(g)}
    assert kinds  # knowledge and story nodes are in the family graph


def test_store_seeds_on_first_request_after_booting_without_falkordb(db, family):
    fam_id = family.family_id
    store = GraphStore(db, FixtureStore(STORIES, {p.id: p for p in PATTERNS}), fam_id, [1])
    assert store._seeded is False  # booted without seeding (as when FalkorDB was unreachable)
    assert [p.id for p in store.patients()] == ["syn-p1"]  # the first request seeds
    assert store._seeded is True


def test_reset_one_story_restores_only_its_subgraph(db, family):
    store = GraphStore(db, FixtureStore(STORIES, {p.id: p for p in PATTERNS}), family.family_id, [1, 3])
    store.ensure_seeded()
    g = db.select_graph(family_graph(family.family_id))
    fresh = counts(g)
    store.submit_evidence("syn-p3", P3_EVENT)
    assert store.findings("syn-p3").findings[0].status == "needs_reassessment"
    store.reset("syn-p3")
    assert counts(g) == fresh  # nothing of the old syn-p3 is left behind, nothing is doubled
    assert store.findings("syn-p3").findings[0].status == "reviewed"
    assert store.timeline("syn-p3").pending_evidence[0].event_id == P3_EVENT.event_id

    store.submit_evidence("syn-p1", evidence("syn-p1", 1, 2, "syn-p1:ep-furosemide", "indication",
                                             state="not_available"))
    store.submit_evidence("syn-p3", P3_EVENT)
    store.reset("syn-p3")
    assert store.findings("syn-p1").case_version == 3  # the other story keeps its changes
    assert store.findings("syn-p3").case_version == 4
    assert store.submit_evidence("syn-p3", P3_EVENT).replayed is False  # its event log went with it
    with pytest.raises(NotFound):
        store.reset("syn-p2")  # not configured for this store
