import pytest
from fastapi.testclient import TestClient

from api.main import app, store
from api.store import change_summary

P1_FINDING = "syn-p1:fnd-ccb-edema-loop-1"
P3_FINDING = "syn-p3:fnd-ccb-edema-loop-1"
P3_EVENT = {
    "event_id": "syn-p3:evt-onset-correction",
    "case_version": 4,
    "change": {
        "fact_id": "syn-p3:obs-ankle-swelling",
        "field": "happened_at",
        "value": 14,
        "state": "documented",
        "source_id": "syn-p3:src-gp-note-d14",
    },
}


@pytest.fixture
def client():
    store.reset()
    with TestClient(app) as c:
        yield c


def test_health(client):
    body = client.get("/health").json()
    assert body == {"status": "ok", "mode": "fixtures", "falkordb": "not_used", "appendonly": None}


def test_patients_are_synthetic(client):
    patients = client.get("/patients").json()
    assert [p["id"] for p in patients] == ["syn-p1", "syn-p2", "syn-p3"]
    assert all(p["synthetic"] for p in patients)


def test_timeline_and_findings(client):
    t = client.get("/patients/syn-p1/timeline").json()
    assert {e["ingredient"]["name"] for e in t["episodes"]} == {"amlodipine", "furosemide"}
    f = client.get("/patients/syn-p2/findings").json()
    assert f["findings"][0]["status"] == "competing_explanation"


def test_unknown_patient_is_404(client):
    assert client.get("/patients/nobody/timeline").status_code == 404


def test_investigation_story1_asks_for_indication(client):
    inv = client.get(f"/findings/{P1_FINDING}/investigation").json()
    assert [u["field"] for u in inv["unknowns"]] == ["indication"]
    assert inv["next_question"]["id"] == "syn-p1:q-furosemide-indication"
    assert "q4_evidence_pack" in {q["query"] for q in inv["query_trace"]}


def test_stale_case_version_is_409(client):
    r = client.post("/patients/syn-p3/evidence", json={**P3_EVENT, "case_version": 3})
    assert r.status_code == 409
    assert r.json() == {
        "error": "stale_case_version", "patient_id": "syn-p3", "sent": 3, "current": 4,
    }


def test_correction_under_reviewed_finding_creates_revision_and_keeps_decision(client):
    r = client.post("/patients/syn-p3/evidence", json=P3_EVENT)
    assert r.status_code == 200
    res = r.json()
    assert (res["case_version_before"], res["case_version"]) == (4, 5)
    assert res["before"]["happened_at"] == 28 and res["after"]["happened_at"] == 14
    assert res["new_revisions"][0]["n"] == 2
    inv = client.get(f"/findings/{P3_FINDING}/investigation").json()
    assert inv["finding"]["status"] == "needs_reassessment"
    assert [d["revision_n"] for d in inv["decisions"]] == [1]
    assert [rev["n"] for rev in inv["revisions"]] == [1, 2]


def test_evidence_event_is_idempotent(client):
    first = client.post("/patients/syn-p3/evidence", json=P3_EVENT).json()
    again = client.post("/patients/syn-p3/evidence", json=P3_EVENT)
    assert again.status_code == 200
    assert again.json()["replayed"] is True
    assert again.json()["case_version"] == first["case_version"] == 5
    assert len(client.get(f"/findings/{P3_FINDING}/investigation").json()["revisions"]) == 2


def test_not_available_is_not_a_no(client):
    body = {
        "event_id": "syn-p1:evt-na",
        "case_version": 2,
        "change": {
            "fact_id": "syn-p1:ep-furosemide", "field": "indication", "state": "not_available",
        },
    }
    res = client.post("/patients/syn-p1/evidence", json=body).json()
    assert res["after"]["indication"] is None
    assert res["after"]["indication_state"] == "not_available"
    assert res["pending_reevaluation_ids"] == [P1_FINDING]


def test_event_must_be_patient_scoped(client):
    body = {**P3_EVENT, "event_id": "syn-p1:evt-x"}
    assert client.post("/patients/syn-p3/evidence", json=body).status_code == 422


def test_review_and_stale_revision(client):
    body = {
        "case_version": 2, "revision_n": 1, "by_role": "pharmacist", "decision": "defer",
        "reason": "Waiting for the furosemide reason.",
    }
    r = client.post(f"/findings/{P1_FINDING}/review", json=body)
    assert r.status_code == 200 and r.json()["case_version"] == 3
    stale = client.post(
        f"/findings/{P1_FINDING}/review", json={**body, "case_version": 3, "revision_n": 0}
    )
    assert stale.status_code == 409 and stale.json()["error"] == "stale_revision"


def test_packet_and_reset(client):
    client.post("/patients/syn-p3/evidence", json=P3_EVENT)
    pk = client.get("/patients/syn-p3/packet").json()
    assert pk["case_version"] == 5 and pk["items"][0]["decisions"][0]["revision_n"] == 1
    assert "Synthetic" in pk["disclaimer"]
    client.post("/sandbox/reset")
    assert client.get("/patients/syn-p3/findings").json()["case_version"] == 4


def test_a_missing_value_reads_not_recorded_never_none(client):
    body = {"event_id": "syn-p3:evt-stop", "case_version": 4, "change": {
        "fact_id": "syn-p3:ep-atorvastatin", "field": "stop_day", "value": 50, "state": "documented"}}
    res = client.post("/patients/syn-p3/evidence", json=body).json()
    assert res["affected_finding_ids"] == [] and res["new_revisions"] == []
    summary = change_summary(res["before"], res["after"], "stop_day")
    assert summary == "atorvastatin: stop_day changed from not recorded to 50."
    before = {"id": "syn-p1:ep-furosemide", "ingredient": {"name": "furosemide"},
              "indication": None, "indication_state": "unknown"}
    after = {**before, "indication": "ankle swelling", "indication_state": "reported"}
    text = change_summary(before, after, "indication")
    assert text == "furosemide: indication changed from not recorded (unknown) to ankle swelling (reported)."
    assert "None" not in change_summary(after, before, "indication_state")


def test_questions_route(client):
    rid = "syn-p1:req-furosemide-indication"
    stale = client.post("/questions", json={"case_version": 1, "requirement_id": rid})
    assert stale.status_code == 409 and stale.json()["error"] == "stale_case_version"
    banned = client.post("/questions", json={"case_version": 2, "requirement_id": rid, "text": "Is it safe?"})
    assert banned.status_code == 422
    unknown = client.post("/questions", json={"case_version": 2, "requirement_id": "syn-p1:req-x"})
    assert unknown.status_code == 404

    r = client.post("/questions", json={"case_version": 2, "requirement_id": rid})
    assert r.status_code == 200
    body = r.json()
    assert (body["case_version"], body["replayed"], body["question"]["asked_at"]) == (3, False, 60)
    inv = client.get(f"/findings/{P1_FINDING}/investigation").json()
    assert inv["next_question"]["asked_at"] == 60 and inv["case_version"] == 3
    again = client.post("/questions", json={"case_version": 2, "requirement_id": rid}).json()
    assert again["replayed"] is True and again["question"] == body["question"]


def test_agent_steps_routes(client):
    seeded = client.get("/patients/syn-p1/agent-steps").json()
    assert [s["id"] for s in seeded["steps"]] == ["syn-p1:step-1"] and seeded["case_version"] == 2
    step = {
        "step_id": "syn-p1:step-2", "case_version": 2, "finding_id": P1_FINDING, "tool": "get_investigation",
        "ok": True, "args": {"fid": P1_FINDING}, "result_ids": ["syn-p1:ep-furosemide"],
    }
    r = client.post("/agent-steps", json=step)
    assert r.status_code == 200
    assert (r.json()["case_version"], r.json()["replayed"], r.json()["step"]["at"]) == (2, False, 60)
    assert client.post("/agent-steps", json=step).json()["replayed"] is True
    steps = client.get("/patients/syn-p1/agent-steps").json()
    assert [s["id"] for s in steps["steps"]] == ["syn-p1:step-1", "syn-p1:step-2"]
    assert steps["case_version"] == 2  # an agent step does not move the case version

    other = {**step, "step_id": "syn-p1:step-3"}
    assert client.post("/agent-steps", json={**other, "case_version": 1}).status_code == 409
    assert client.post("/agent-steps", json={**other, "result_ids": ["syn-p2:x"]}).status_code == 422
    assert client.post("/agent-steps", json={**other, "tool": "create_finding"}).status_code == 422
    assert client.post("/agent-steps", json={**other, "finding_id": "syn-p1:fnd-x"}).status_code == 404
    assert client.get("/patients/nobody/agent-steps").status_code == 404


def test_reset_one_story_keeps_the_others(client):
    client.post("/patients/syn-p3/evidence", json=P3_EVENT)
    p1 = {"event_id": "syn-p1:evt-na", "case_version": 2, "change": {
        "fact_id": "syn-p1:ep-furosemide", "field": "indication", "state": "not_available"}}
    assert client.post("/patients/syn-p1/evidence", json=p1).status_code == 200
    res = client.post("/sandbox/reset", json={"patient_id": "syn-p3"})
    assert res.status_code == 200 and res.json()["reset"] is True
    assert client.get("/patients/syn-p3/findings").json()["case_version"] == 4
    assert client.get("/patients/syn-p1/findings").json()["case_version"] == 3  # untouched
    replay = client.post("/patients/syn-p1/evidence", json=p1).json()
    assert replay["replayed"] is True  # syn-p1's events are kept too
    again = client.post("/patients/syn-p3/evidence", json=P3_EVENT).json()
    assert again["replayed"] is False  # syn-p3's events were forgotten with its story
    assert client.post("/sandbox/reset", json={"patient_id": "nobody"}).status_code == 404
    client.post("/sandbox/reset", json={})
    assert client.get("/patients/syn-p1/findings").json()["case_version"] == 2
