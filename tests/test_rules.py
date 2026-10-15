"""engine/rules.py on hand-built Q1 rows (no database). Graph-backed checks are in test_graph.py."""

import re

import pytest

from engine import rules

PID = "syn-p1"
FID = "syn-p1:fnd-ccb-edema-loop-1"


def row(**over):
    """A Q1 row shaped like Story 1: amlodipine day 0, swelling day 21 (reported), furosemide day 35."""
    base = {
        "index_ep": "syn-p1:ep-amlodipine", "a_name": "amlodipine", "a_start": 0, "a_state": "documented",
        "marker_ep": "syn-p1:ep-furosemide", "b_name": "furosemide", "b_start": 35, "b_state": "documented",
        "b_indication": None, "b_ind_state": "unknown",
        "pattern": "pat-ccb-edema-loop", "pattern_version": 1, "window_days": 90,
        "requires": ["start_day", "onset_day", "indication", "order"], "effect": "peripheral_edema",
        "observations": [["syn-p1:obs-ankle-swelling", 21, "reported", "Ankle swelling"]],
    }
    return {**base, **over}


def ev(**over):
    return rules.evaluate(row(**over), PID, FID)


def kinds(e):
    return sorted((r.kind, r.about_fact_id, r.field, r.state) for r in e.requirements)


def test_story1_needs_the_furosemide_indication():
    e = ev()
    assert e.status == "needs_evidence"
    assert [r.id for r in e.requirements] == ["syn-p1:req-furosemide-indication"]
    assert e.headline == "Possible pattern: amlodipine, then ankle swelling, then furosemide"


def test_unknown_onset_stays_unknown_and_becomes_a_requirement():
    e = ev(b_indication="ankle swelling", b_ind_state="reported",
           observations=[["syn-p1:obs-ankle-swelling", None, "unknown", "Ankle swelling"]])
    assert e.status == "needs_evidence"  # never not_matched, never candidate
    assert kinds(e) == [("onset_day", "syn-p1:obs-ankle-swelling", "happened_at", "missing")]
    assert e.observation_ids == ["syn-p1:obs-ankle-swelling"]


def test_unknown_onset_with_a_late_documented_day_elsewhere_is_still_not_ruled_out():
    # A null onset must not be read as day 0 (which would put it "before" amlodipine on day 5).
    e = ev(a_start=5, observations=[["syn-p1:obs-ankle-swelling", None, "reported", "Ankle swelling"]])
    assert e.status == "needs_evidence"
    assert ("onset_day", "syn-p1:obs-ankle-swelling", "happened_at", "missing") in kinds(e)


def test_no_observation_recorded_is_not_known_yet_rather_than_no():
    e = ev(observations=[[None, None, None, None]])  # Q1's collect() over an empty OPTIONAL MATCH
    assert e.status == "needs_evidence"
    assert ("onset_day", "syn-p1:ep-amlodipine", "via_effect", "missing") in kinds(e)
    assert e.observation_ids == []


def test_reversed_documented_starts_are_not_matched():
    e = ev(a_start=40, b_indication="ankle swelling", b_ind_state="documented")
    assert e.status == "not_matched"
    assert e.requirements == []
    assert "furosemide (day 35) before amlodipine (day 40)" in e.reason


def test_reversed_documented_onset_is_not_matched():
    e = ev(observations=[["syn-p1:obs-ankle-swelling", 50, "documented", "Ankle swelling"]])
    assert e.status == "not_matched"


def test_reversed_but_only_reported_asks_for_the_order():
    e = ev(b_indication="ankle swelling", b_ind_state="reported",
           observations=[["syn-p1:obs-ankle-swelling", 50, "reported", "Ankle swelling"]])
    assert e.status == "needs_evidence"
    assert kinds(e) == [("order", "syn-p1:obs-ankle-swelling", "happened_at", "missing")]


@pytest.mark.parametrize(("state", "says"), [
    ("documented", "is documented as"),
    ("reported", "is reported by the caregiver as"),
])
def test_a_different_indication_is_a_competing_explanation_documented_or_reported(state, says):
    e = ev(b_indication="heart failure, new diagnosis during hospital stay", b_ind_state=state)
    assert e.status == "competing_explanation"  # never candidate, whichever way it was recorded
    assert e.requirements == []
    assert e.headline == (
        "Possible pattern: amlodipine, then ankle swelling, then furosemide "
        f"(furosemide has a different {state} reason)"
    )
    reason = 'The reason furosemide was started {} "heart failure, new diagnosis during hospital stay".'
    assert reason.format(says) in e.reason


def test_a_reported_different_indication_is_never_candidate():
    for obs in ([["syn-p1:obs-ankle-swelling", 21, "reported", "Ankle swelling"]],
                [["syn-p1:obs-ankle-swelling", 21, "documented", "Ankle swelling"]]):
        e = ev(b_indication="heart failure", b_ind_state="reported", observations=obs)
        assert e.status == "competing_explanation"


def test_a_competing_explanation_never_calls_the_prescriber_mistaken():
    blame = re.compile(
        r"mistake|error|wrong|inappropriate|unnecessary|should not|shouldn't|incorrect", re.I
    )
    for state in ("documented", "reported"):
        e = ev(b_indication="heart failure", b_ind_state=state)
        for text in (e.headline, e.reason):
            assert not blame.search(text), text


def test_reported_effect_indication_is_candidate():
    e = ev(b_indication="ankle swelling", b_ind_state="reported")
    assert e.status == "candidate"


def test_conflicting_date_stays_candidate_with_the_conflict_listed():
    e = ev(b_indication="ankle swelling", b_ind_state="documented",
           observations=[["syn-p1:obs-ankle-swelling", 21, "conflicting", "Ankle swelling"]])
    assert e.status == "candidate"
    assert e.conflicts == ["syn-p1:obs-ankle-swelling"]
    assert "Records conflict for: syn-p1:obs-ankle-swelling" in e.reason


def test_not_available_indication_is_not_a_no():
    e = ev(b_ind_state="not_available")
    assert e.status == "needs_evidence"
    assert kinds(e) == [("indication", "syn-p1:ep-furosemide", "indication", "not_available")]


def test_unknown_start_day():
    e = ev(a_start=None, a_state="unknown", b_indication="ankle swelling", b_ind_state="documented")
    assert e.status == "needs_evidence"
    assert kinds(e) == [("start_day", "syn-p1:ep-amlodipine", "happened_at", "missing")]


def test_finding_ids_are_stable():
    out = rules.evaluate_rows([row(), row(marker_ep="syn-p1:ep-torasemide", b_name="torasemide")], PID)
    assert [e.finding_id for e in out] == ["syn-p1:fnd-ccb-edema-loop-1", "syn-p1:fnd-ccb-edema-loop-2"]


CAUSAL = re.compile(
    r"\bsafe\b|stop taking|\bcleared\b|caused|\bcauses?\b|due to|led to|because|trigger"
    r"|result(ed|s)? (in|from)",
    re.I,
)


@pytest.mark.parametrize("over", [
    {}, {"a_start": 40}, {"b_indication": "heart failure", "b_ind_state": "documented"},
    {"b_indication": "ankle swelling", "b_ind_state": "reported"},
    {"b_indication": "heart failure", "b_ind_state": "reported"},
    {"observations": [["syn-p1:obs-ankle-swelling", 21, "conflicting", "Ankle swelling"]]},
    {"observations": [[None, None, None, None]]}, {"a_start": None, "a_state": "unknown"},
])
def test_no_causal_wording(over):
    e = ev(**over)
    for text in (e.headline, e.reason):
        assert not CAUSAL.search(text), text
