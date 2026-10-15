import pytest
from fastapi.testclient import TestClient

from api.main import app, store

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
    assert body == {"status": "ok", "mode": "fixtures", "falkordb": "not_used"}


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
