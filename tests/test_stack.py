"""HTTP tests against a running API container in graph mode. Skipped unless FD_API_URL is set.

- `make test-stack` runs them inside the compose network (FD_API_URL=http://api:8000).
- `make test-restart` runs them from the host and also restarts the falkordb and api containers
  (FD_STACK_RESTART=1; needs the docker CLI).

They reset the sandbox before and after each test, so they change the demo family graph.
"""

import os
import subprocess
import time

import httpx
import pytest

from api.store import REPO, load_stories

API = os.environ.get("FD_API_URL")
pytestmark = pytest.mark.skipif(not API, reason="FD_API_URL not set (needs a running api container)")

STORIES = load_stories()
P3_FINDING = "syn-p3:fnd-ccb-edema-loop-1"
P3_EVENT = STORIES["syn-p3"].pending_evidence[0].model_dump(mode="json")


@pytest.fixture
def api():
    with httpx.Client(base_url=API, timeout=60) as c:
        assert c.post("/sandbox/reset").status_code == 200
        yield c
        c.post("/sandbox/reset")


def review_body(case_version: int, revision_n: int) -> dict:
    return {
        "case_version": case_version, "revision_n": revision_n, "by_role": "clinician",
        "decision": "follow_up", "reason": "Possible pattern noted after the date correction.",
    }


def test_the_api_container_serves_graph_mode(api):
    assert api.get("/health").json() == {"status": "ok", "mode": "graph", "falkordb": "up"}
    assert [p["id"] for p in api.get("/patients").json()] == ["syn-p1", "syn-p2", "syn-p3"]
    statuses = {pid: api.get(f"/patients/{pid}/findings").json()["findings"][0]["status"] for pid in STORIES}
    assert statuses == {"syn-p1": "needs_evidence", "syn-p2": "competing_explanation", "syn-p3": "reviewed"}


def test_the_timeline_comes_from_the_graph(api):
    for pid, story in STORIES.items():
        t = api.get(f"/patients/{pid}/timeline").json()
        assert t["patient"] == story.patient.model_dump(mode="json")
        assert {e["id"] for e in t["episodes"]} == {e.id for e in story.episodes}
        assert t["pending_evidence"] == [e.model_dump(mode="json") for e in story.pending_evidence]
    assert api.post("/patients/syn-p3/evidence", json=P3_EVENT).status_code == 200
    t = api.get("/patients/syn-p3/timeline").json()
    assert t["observations"][0]["happened_at"] == 14 and t["pending_evidence"] == []


def test_evidence_and_review_run_against_falkordb(api):
    r = api.post("/patients/syn-p3/evidence", json=P3_EVENT)
    assert r.status_code == 200
    res = r.json()
    assert (res["case_version_before"], res["case_version"]) == (4, 5)
    assert [(v["n"], v["status"]) for v in res["new_revisions"]] == [(2, "needs_reassessment")]
    assert res["finding_changes"][0]["before"]["status"] == "reviewed"

    again = api.post("/patients/syn-p3/evidence", json=P3_EVENT).json()
    assert again["replayed"] is True and again["case_version"] == 5
    stale = api.post("/patients/syn-p3/evidence", json={**P3_EVENT, "event_id": "syn-p3:evt-late"})
    assert stale.status_code == 409
    assert stale.json() == {"error": "stale_case_version", "patient_id": "syn-p3", "sent": 4, "current": 5}

    inv = api.get(f"/findings/{P3_FINDING}/investigation").json()
    assert [r["n"] for r in inv["revisions"]] == [1, 2]
    assert [d["revision_n"] for d in inv["decisions"]] == [1]
    assert all(q["mode"] == "live" for q in inv["query_trace"])

    ok = api.post(f"/findings/{P3_FINDING}/review", json=review_body(5, 2))
    assert ok.status_code == 200 and ok.json()["case_version"] == 6
    assert api.post(f"/findings/{P3_FINDING}/review", json=review_body(5, 2)).status_code == 409

    cross = {**P3_EVENT, "event_id": "syn-p1:evt-cross", "case_version": 2}
    assert api.post("/patients/syn-p1/evidence", json=cross).status_code == 404  # p3 fact via p1
    assert api.post("/patients/syn-p1/evidence", json=P3_EVENT).status_code == 422  # p3 event via p1


def test_unrelated_medicine_questions_and_agent_steps_over_http(api):
    stop = {"event_id": "syn-p3:evt-atorva", "case_version": 4, "change": {
        "fact_id": "syn-p3:ep-atorvastatin", "field": "stop_day", "value": 50, "state": "documented"}}
    res = api.post("/patients/syn-p3/evidence", json=stop).json()
    assert (res["affected_finding_ids"], res["new_revisions"], res["case_version"]) == ([], [], 5)
    assert api.get(f"/findings/{P3_FINDING}/investigation").json()["finding"]["revision_n"] == 1

    rid = "syn-p1:req-furosemide-indication"
    q = api.post("/questions", json={"case_version": 2, "requirement_id": rid})
    assert q.status_code == 200 and q.json()["case_version"] == 3 and q.json()["question"]["asked_at"] == 60
    assert api.post("/questions", json={"case_version": 2, "requirement_id": rid}).json()["replayed"] is True

    step = {"step_id": "syn-p1:step-2", "case_version": 3, "finding_id": "syn-p1:fnd-ccb-edema-loop-1",
            "tool": "get_investigation", "ok": True, "args": {}, "result_ids": ["syn-p1:ep-furosemide"]}
    assert api.post("/agent-steps", json=step).status_code == 200
    steps = api.get("/patients/syn-p1/agent-steps").json()
    assert [s["id"] for s in steps["steps"]] == ["syn-p1:step-1", "syn-p1:step-2"]
    assert steps["case_version"] == 3  # an agent step does not move it


def _compose(*args: str) -> str:
    return subprocess.run(
        ["docker", "compose", *args], cwd=REPO, check=True, capture_output=True, text=True,
    ).stdout.strip()


def _started_at(service: str) -> str:
    cid = _compose("ps", "-q", service)
    return subprocess.run(
        ["docker", "inspect", "-f", "{{.State.StartedAt}}", cid], check=True, capture_output=True, text=True,
    ).stdout.strip()


def _wait_healthy(c: httpx.Client, seconds: float = 120) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if c.get("/health").json().get("falkordb") == "up":
                return
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(2)
    raise AssertionError("api did not come back")


@pytest.mark.skipif(os.environ.get("FD_STACK_RESTART") != "1", reason="set FD_STACK_RESTART=1")
def test_restart_of_api_and_falkordb_keeps_everything(api):
    api.post("/patients/syn-p3/evidence", json=P3_EVENT).raise_for_status()
    api.post(f"/findings/{P3_FINDING}/review", json=review_body(5, 2)).raise_for_status()

    def state():
        return (
            api.get("/patients/syn-p3/timeline").json(), api.get("/patients/syn-p3/findings").json(),
            api.get(f"/findings/{P3_FINDING}/investigation").json(),
        )

    seen = state()
    started = {s: _started_at(s) for s in ("falkordb", "api")}
    _compose("restart", "falkordb", "api")
    _wait_healthy(api)
    assert all(_started_at(s) != started[s] for s in started), "containers did not restart"

    assert state() == seen
    timeline, findings, inv = seen
    assert timeline["patient"]["case_version"] == 6
    assert [(r["n"], r["status"]) for r in inv["revisions"]] == [(1, "candidate"), (2, "needs_reassessment")]
    assert [d["revision_n"] for d in inv["decisions"]] == [1, 2]
    replay = api.post("/patients/syn-p3/evidence", json=P3_EVENT).json()  # the event log persisted too
    assert replay["replayed"] is True and replay["case_version"] == 5
