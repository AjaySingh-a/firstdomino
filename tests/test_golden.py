"""Golden tests for Stories 2 and 3 against a real FalkorDB (skipped without one, like test_graph.py).

Every expected status, requirement, revision and case_version below is written out in full: a change
to the rules or the loaders that moves any of them has to change this file too.
"""

import re
import uuid

import pytest

from api.graph_store import GraphStore
from api.models import EvidenceRequest
from api.store import REPO, FixtureStore, load_patterns, load_stories
from engine.db import connect, family_graph, run
from engine.loaders.seed import seed

STORIES = load_stories()
PATTERNS = list(load_patterns().values())
P2, P3 = "syn-p2", "syn-p3"
P2_FINDING = "syn-p2:fnd-ccb-edema-loop-1"
P3_FINDING = "syn-p3:fnd-ccb-edema-loop-1"
P3_DECISION = "syn-p3:fnd-ccb-edema-loop-1:rev-1:dec-1"
P3_CORRECTION = STORIES[P3].pending_evidence[0]  # onset day 28 (reported) -> 14 (documented, GP note)
ATORVASTATIN = "syn-p3:ep-atorvastatin"  # in no curated pattern

P2_HEADLINE = (
    "Possible pattern: amlodipine, then ankle swelling, then furosemide "
    "(furosemide has a different documented reason)"
)
P2_REASON = (
    'First evaluation. The reason furosemide was started is documented as "heart failure, new diagnosis '
    'during hospital stay". This is another explanation worth reviewing alongside the pattern.'
)
# Wording that would say the prescriber got it wrong. A competing explanation is shown, never judged.
BLAME = re.compile(
    r"mistake|\berror|wrong|inappropriate|unnecessary|should not|shouldn't|incorrect|instead of", re.I
)


@pytest.fixture(scope="module")
def db():
    try:
        conn = connect()
        conn.connection.ping()
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"FalkorDB not reachable: {exc}")
    return conn


@pytest.fixture
def graph(db):
    """Seeds the given stories into throwaway graphs; yields (family graph, store); drops them after."""
    made = []

    def load(*stories):
        tag = f"golden_{uuid.uuid4().hex[:8]}"
        fam_id, kb = tag, f"kb_{tag}"
        made.extend([kb, family_graph(fam_id)])
        g = seed(db, fam_id, list(stories), PATTERNS, reset=True, kb_name=kb)
        store = GraphStore(db, FixtureStore(STORIES, {p.id: p for p in PATTERNS}), fam_id, [])
        return g, store

    yield load
    for name in made:
        if name in db.list_graphs():
            db.select_graph(name).delete()


def requirement_states(g, pid):
    return {r["id"]: r["state"] for r in run(g, "admin/requirement_states", pid=pid)}


def history(store, fid):
    inv = store.investigation(fid)
    revisions = [(r.n, r.status, r.previous_n) for r in inv.revisions]
    return revisions, [(d.id, d.revision_n) for d in inv.decisions]


def change(pid, n, case_version, fact_id, field, value, state="documented"):
    return EvidenceRequest.model_validate({
        "event_id": f"{pid}:evt-{n}", "case_version": case_version,
        "change": {"fact_id": fact_id, "field": field, "value": value, "state": state},
    })


# ---------- every story: the graph gives exactly what its fixture says ----------


@pytest.mark.parametrize("pid", ["syn-p1", P2, P3])
def test_the_graph_reproduces_each_fixture(graph, pid):
    story = STORIES[pid]
    g, store = graph(story)
    assert store.findings(pid).findings == story.findings
    for f in story.findings:
        inv = store.investigation(f.id)
        assert inv.revisions == [r for r in story.revisions if r.finding_id == f.id]
        assert inv.decisions == [d for d in story.decisions if d.finding_id == f.id]
    assert requirement_states(g, pid) == {r.id: r.state for r in story.requirements}
    assert store.agent_steps(pid).steps == story.agent_steps
    assert store.timeline(pid).patient.case_version == story.patient.case_version


# ---------- Story 2: an independent documented reason ----------


def test_story2_is_a_competing_explanation(graph):
    g, store = graph(STORIES[P2])
    (f,) = store.findings(P2).findings
    assert (f.id, f.status, f.revision_n) == (P2_FINDING, "competing_explanation", 1)
    assert f.requirement_ids == [] and requirement_states(g, P2) == {}
    assert f.headline == P2_HEADLINE

    inv = store.investigation(P2_FINDING)
    assert [(r.n, r.status, r.previous_n, r.reason) for r in inv.revisions] == [
        (1, "competing_explanation", None, P2_REASON),
    ]
    assert inv.decisions == [] and inv.case_version == 2
    assert inv.unknowns == [] and inv.conflicts == [] and inv.next_question is None
    reason = [d for d in inv.documented if d.field == "indication"]
    assert [(d.fact_id, d.value, d.state, d.source_ids) for d in reason] == [
        ("syn-p2:ep-furosemide", "heart failure, new diagnosis during hospital stay", "documented",
         ["syn-p2:src-discharge-d33"]),
    ]
    # Shown, never dismissed: it stays in the clinician's packet.
    assert [i.finding.id for i in store.packet(P2).items] == [P2_FINDING]


def test_story2_never_labels_the_prescriber_mistaken(graph):
    _, store = graph(STORIES[P2])
    inv = store.investigation(P2_FINDING)
    texts = [inv.finding.headline, *(r.reason for r in inv.revisions), store.packet(P2).disclaimer]
    for text in texts:
        assert not BLAME.search(text), text


def test_story2_with_the_reason_only_reported_is_still_a_competing_explanation(graph):
    s = STORIES[P2].model_copy(deep=True)
    s.episodes[1].indication_state = "reported"
    _, store = graph(s)
    (f,) = store.findings(P2).findings
    assert (f.status, f.requirement_ids) == ("competing_explanation", [])
    assert f.headline.endswith("(furosemide has a different reported reason)")
    (rev,) = store.investigation(P2_FINDING).revisions
    assert 'is reported by the caregiver as "heart failure, new diagnosis during hospital stay"' in rev.reason
    assert not BLAME.search(rev.reason)


# ---------- Story 3: review, date correction, unrelated change ----------


def test_story3_decision_correction_then_unrelated_change(graph):
    g, store = graph(STORIES[P3])

    # 1. A clinician decision on revision 1.
    (f,) = store.findings(P3).findings
    assert (f.status, f.revision_n, f.requirement_ids) == ("reviewed", 1, [])
    assert history(store, P3_FINDING) == ([(1, "candidate", None)], [(P3_DECISION, 1)])
    decision = store.investigation(P3_FINDING).decisions[0]
    assert store.timeline(P3).patient.case_version == 4

    # 2. The date correction: revision 2 needs reassessment, the decision stays on revision 1.
    res = store.submit_evidence(P3, P3_CORRECTION)
    assert (res.case_version_before, res.case_version) == (4, 5)
    assert res.affected_finding_ids == [P3_FINDING]
    assert [(r.id, r.n, r.previous_n, r.status) for r in res.new_revisions] == [
        (f"{P3_FINDING}:rev-2", 2, 1, "needs_reassessment"),
    ]
    assert res.new_revisions[0].reason == (
        "Ankle swelling: happened_at changed from 28 (reported) to 14 (documented). "
        "Revision 1 was reviewed, so it needs a fresh look. "
        "The documented and reported days fit the order of this pattern."
    )
    (f,) = store.findings(P3).findings
    assert (f.status, f.revision_n, f.requirement_ids) == ("needs_reassessment", 2, [])
    assert history(store, P3_FINDING) == (
        [(1, "candidate", None), (2, "needs_reassessment", 1)], [(P3_DECISION, 1)],
    )
    assert store.investigation(P3_FINDING).decisions == [decision]  # intact, word for word
    assert requirement_states(g, P3) == {}

    # 3. An unrelated medicine changes: nothing depends on it, so no finding gets a revision.
    assert run(g, "q3_affected", pid=P3, fact_id=ATORVASTATIN) == []
    findings_before = store.findings(P3).findings
    for n, (fld, value) in enumerate([("happened_at", 7), ("indication", "familial high cholesterol")]):
        res = store.submit_evidence(P3, change(P3, f"atorva-{n}", 5 + n, ATORVASTATIN, fld, value))
        assert (res.case_version_before, res.case_version) == (5 + n, 6 + n)
        assert (res.affected_finding_ids, res.new_revisions, res.finding_changes) == ([], [], [])
        assert res.pending_reevaluation_ids == []
    assert store.findings(P3).findings == findings_before
    assert history(store, P3_FINDING) == (
        [(1, "candidate", None), (2, "needs_reassessment", 1)], [(P3_DECISION, 1)],
    )
    assert store.timeline(P3).patient.case_version == 7
    counts = {(r["kind"], r["name"]): r["n"] for r in run(g, "admin/graph_counts")}
    assert counts[("node", "FindingRevision")] == 2


def test_story3_unrelated_medicine_is_in_the_timeline_and_no_finding(graph):
    _, store = graph(STORIES[P3])
    t = store.timeline(P3)
    assert [e.id for e in t.episodes] == ["syn-p3:ep-amlodipine", ATORVASTATIN, "syn-p3:ep-furosemide"]
    (f,) = store.findings(P3).findings
    assert ATORVASTATIN not in (f.index_episode_id, f.marker_episode_id, *f.observation_ids)


def test_the_change_card_says_nothing_was_re_evaluated():
    card = (REPO / "web" / "components" / "change-card.tsx").read_text(encoding="utf-8")
    assert '"No finding depends on this fact; nothing was re-evaluated."' in card


def test_story3_fixture_mode_unrelated_change_affects_nothing():
    fixtures = FixtureStore(STORIES, {p.id: p for p in PATTERNS})
    res = fixtures.submit_evidence(P3, change(P3, "atorva", 4, ATORVASTATIN, "stop_day", 50))
    assert (res.affected_finding_ids, res.new_revisions, res.pending_reevaluation_ids) == ([], [], [])
    assert fixtures.findings(P3).findings == STORIES[P3].findings
    assert (res.before["stop_day"], res.after["stop_day"]) == (None, 50)
