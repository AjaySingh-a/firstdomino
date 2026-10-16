"""Deployment behaviour without a real FalkorDB: FALKORDB_URL parsing, 503 when FalkorDB is unreachable,
/health when degraded, and the review-agent rate limit."""

import json

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

import api.main
from agent import review_agent
from api.graph_store import GraphStore
from api.main import RateLimit, app, client_ip
from api.store import FixtureStore, load_patterns, load_stories
from engine.db import connection_settings

P1 = "syn-p1:fnd-ccb-edema-loop-1"
SECRET = "s3cr3t-p@ss"


# ---------- FALKORDB_URL ----------


@pytest.fixture
def no_db_env(monkeypatch):
    for k in ("FALKORDB_URL", "FALKORDB_HOST", "FALKORDB_PORT", "FALKORDB_PASSWORD"):
        monkeypatch.delenv(k, raising=False)


def test_url_wins_over_host_and_port(monkeypatch, no_db_env):
    monkeypatch.setenv("FALKORDB_HOST", "elsewhere")
    monkeypatch.setenv("FALKORDB_PORT", "1")
    monkeypatch.setenv("FALKORDB_URL", "redis://default:s3cr3t-p%40ss@falkordb.railway.internal:16379")
    s = connection_settings()
    assert (s["host"], s["port"], s["username"], s["password"], s["ssl"]) == (
        "falkordb.railway.internal", 16379, None, SECRET, False,
    )


def test_url_with_a_named_user_and_tls(monkeypatch, no_db_env):
    monkeypatch.setenv("FALKORDB_URL", "rediss://alice:pw@db.example:6380")
    s = connection_settings()
    assert (s["username"], s["password"], s["port"], s["ssl"]) == ("alice", "pw", 6380, True)


def test_host_and_port_without_a_url(monkeypatch, no_db_env):
    monkeypatch.setenv("FALKORDB_HOST", "falkordb")
    monkeypatch.setenv("FALKORDB_PASSWORD", "pw")
    s = connection_settings()
    assert (s["host"], s["port"], s["password"]) == ("falkordb", 6379, "pw")


def test_a_bad_url_never_echoes_its_value(monkeypatch, no_db_env):
    monkeypatch.setenv("FALKORDB_URL", f"http://user:{SECRET}@host:1")
    with pytest.raises(ValueError) as e:
        connection_settings()
    assert SECRET not in str(e.value) and "host" not in str(e.value).split("like")[0]


# ---------- FalkorDB unreachable: 503, never an empty list ----------


class DownConnection:
    def ping(self):
        raise RedisConnectionError("Error connecting to falkordb.railway.internal:16379")

    def config_get(self, *_):
        raise RedisConnectionError("down")


class DownDB:
    connection = DownConnection()

    def list_graphs(self):
        raise RedisConnectionError("Error connecting to falkordb.railway.internal:16379")

    def select_graph(self, name):
        raise RedisConnectionError("down")


@pytest.fixture
def down_client(monkeypatch):
    fixtures = FixtureStore(load_stories(), load_patterns())
    monkeypatch.setattr(api.main, "store", GraphStore(DownDB(), fixtures, "demo", [1, 2, 3]))
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("method, path", [
    ("get", "/patients"),
    ("get", "/patients/syn-p1/timeline"),
    ("get", "/patients/syn-p1/findings"),
    ("get", f"/findings/{P1}/investigation"),
    ("get", "/patients/syn-p1/packet"),
    ("get", "/patients/syn-p1/agent-steps"),
    ("post", "/sandbox/reset"),
])
def test_unreachable_falkordb_is_503_not_an_empty_list(down_client, method, path):
    r = getattr(down_client, method)(path)
    assert r.status_code == 503
    assert r.json() == {"error": "evaluation_unavailable", "detail": "evaluation unavailable"}
    assert "railway.internal" not in r.text  # the error is not echoed


def test_health_is_degraded_but_200_when_falkordb_is_down(down_client):
    r = down_client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "degraded", "mode": "graph", "falkordb": "down", "appendonly": "unknown"}


# ---------- review-agent rate limit ----------


def test_rate_limit_window():
    limit = RateLimit(2)
    assert [limit.allow(k) for k in ("a", "a", "a", "b")] == [True, True, False, True]


def test_client_ip_behind_a_proxy():
    class Req:
        def __init__(self, headers, host="10.0.0.1"):
            self.headers = headers
            self.client = type("C", (), {"host": host})()

    assert client_ip(Req({"x-real-ip": "1.2.3.4"})) == "1.2.3.4"
    # the left entries are whatever the client sent; the proxy appends the real address on the right
    assert client_ip(Req({"x-forwarded-for": "6.6.6.6, 5.6.7.8"})) == "5.6.7.8"
    assert client_ip(Req({})) == "10.0.0.1"


class GoodLLM:
    model = "fake"

    def complete_json(self, system, user):
        s = json.loads(user)["suggested"]
        text = {
            "ask_question": "Why was furosemide started around day 35?",
            "prepare_packet": "Possible pattern worth reviewing: amlodipine day 0, furosemide day 35.",
        }.get(s["tool"])
        return json.dumps({"tool": s["tool"], "args": s["args"], "text": text, "cited_ids": []})


def test_over_the_limit_the_pass_runs_on_templates(monkeypatch):
    monkeypatch.setattr(api.main, "agent_limit", RateLimit(1))
    monkeypatch.setattr(api.main, "llm_from_env", lambda: GoodLLM())
    monkeypatch.setattr(review_agent, "RETRY_DELAY_S", 0)
    api.main.store.reset()
    with TestClient(app) as c:
        first = c.post(f"/findings/{P1}/review-agent", json={"case_version": 2}).json()
        assert first["phrasing"] == "llm"
        second = c.post(f"/findings/{P1}/review-agent", json={"case_version": first["case_version"]}).json()
    assert second["phrasing"] == "template"
    assert {s["args"]["fallback_reason"] for s in second["steps"]} == {"rate_limited"}
    assert len(second["steps"]) == 5  # the pass still runs end to end (the question was asked already)
    api.main.store.reset()
