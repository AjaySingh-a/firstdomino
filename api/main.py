"""FastAPI routes. FD_STORE=graph (the docker-compose default) reads and writes FalkorDB through
GraphStore (api/graph_store.py), which checks the patient exists in a family graph before every
patient-scoped call. FD_STORE=fixtures (the default without compose) serves data/stories from memory
through FixtureStore, which also produces the snapshots the web app uses offline.
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from agent.llm import llm_from_env
from agent.review_agent import run_review_agent
from api.graph_store import graph_store_from_env
from api.models import (
    AffectedResponse,
    AgentStepRequest,
    AgentStepResult,
    AgentStepsResponse,
    ConflictError,
    EvidenceRequest,
    EvidenceResult,
    FindingsResponse,
    HealthResponse,
    InvestigationResponse,
    PacketResponse,
    Patient,
    QuestionRequest,
    QuestionResult,
    ResetResponse,
    ReviewAgentRequest,
    ReviewAgentResult,
    ReviewRequest,
    ReviewResult,
    TimelineResponse,
)
from api.store import Conflict, Invalid, NotFound, default_store, patient_of


def cors_origins(raw: str | None) -> list[str]:
    """FD_CORS_ORIGINS: a comma-separated list ("http://localhost:3001, https://x.vercel.app"). Spaces
    and a trailing slash are ignored, since the browser's Origin header has neither."""
    return [o.strip().rstrip("/") for o in (raw or "http://localhost:3001").split(",") if o.strip()]


app = FastAPI(title="FirstDomino API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(os.environ.get("FD_CORS_ORIGINS")),
    allow_methods=["*"],
    allow_headers=["*"],
)


def _make_store():
    if os.environ.get("FD_STORE", "fixtures") == "graph":
        return graph_store_from_env(default_store())
    return default_store()


store = _make_store()

CONFLICT = {409: {"model": ConflictError}}


@app.exception_handler(Conflict)
async def _conflict(_: Request, exc: Conflict):
    return JSONResponse(status_code=409, content=exc.body)


@app.exception_handler(NotFound)
async def _not_found(_: Request, exc: NotFound):
    return JSONResponse(status_code=404, content={"error": "not_found", "detail": str(exc)})


@app.exception_handler(Invalid)
async def _invalid(_: Request, exc: Invalid):
    return JSONResponse(status_code=422, content={"error": "invalid", "detail": str(exc)})


UNAVAILABLE = {"error": "evaluation_unavailable", "detail": "evaluation unavailable"}


@app.exception_handler(RedisConnectionError)
@app.exception_handler(RedisTimeoutError)
async def _unavailable(_: Request, __: Exception):
    """FalkorDB unreachable (or still loading its AOF): say so. Never an empty list, which would read as
    "no patients" or "no pattern". The error itself is not echoed: it can name the host."""
    return JSONResponse(status_code=503, content=UNAVAILABLE)


@app.get("/health")
def health() -> HealthResponse:
    """Always 200 while the process runs (the platform's liveness check); `status` says "degraded" when
    FalkorDB is not reachable."""
    if getattr(store, "mode", "fixtures") == "graph":
        up = store.falkordb_up()
        return HealthResponse(
            status="ok" if up else "degraded", mode="graph", falkordb="up" if up else "down",
            appendonly=store.appendonly() if up else "unknown",
        )
    return HealthResponse(status="ok", mode="fixtures", falkordb="not_used")


@app.get("/patients")
def patients() -> list[Patient]:
    return store.patients()


@app.get("/patients/{pid}/timeline")
def timeline(pid: str) -> TimelineResponse:
    return store.timeline(pid)


@app.get("/patients/{pid}/findings")
def findings(pid: str) -> FindingsResponse:
    return store.findings(pid)


@app.get("/findings/{fid}/investigation")
def investigation(fid: str) -> InvestigationResponse:
    return store.investigation(fid)


@app.post("/patients/{pid}/evidence", responses=CONFLICT)
def evidence(pid: str, req: EvidenceRequest) -> EvidenceResult:
    return store.submit_evidence(pid, req)


@app.post("/findings/{fid}/review", responses=CONFLICT)
def review(fid: str, req: ReviewRequest) -> ReviewResult:
    return store.review(fid, req)


@app.post("/questions", responses=CONFLICT)
def ask_question(req: QuestionRequest) -> QuestionResult:
    return store.ask_question(req)


@app.post("/agent-steps", responses=CONFLICT)
def record_agent_step(req: AgentStepRequest) -> AgentStepResult:
    return store.record_agent_step(req)


@app.get("/patients/{pid}/agent-steps")
def agent_steps(pid: str) -> AgentStepsResponse:
    return store.agent_steps(pid)


@app.get("/patients/{pid}/facts/{fact_id}/affected")
def affected(pid: str, fact_id: str) -> AffectedResponse:
    return store.affected(pid, fact_id)


class RateLimit:
    """At most `per_minute` LLM-backed agent passes per client IP in any 60 s window, in memory (one
    API process). Over the limit the pass still runs, on templates."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque[float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits.setdefault(key, deque())
            while q and now - q[0] >= 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return False
            q.append(now)
            return True


agent_limit = RateLimit(int(os.environ.get("FD_AGENT_RATE_PER_MIN", "10")))


def client_ip(request: Request) -> str:
    """The caller's IP behind Railway's proxy: X-Real-IP, else the right-most X-Forwarded-For entry (the
    one the proxy added; entries to its left are whatever the client sent), else the socket peer."""
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if forwarded:
        return forwarded[-1]
    return request.client.host if request.client else "unknown"


@app.post("/findings/{fid}/review-agent", responses=CONFLICT)
def review_agent(fid: str, req: ReviewAgentRequest, request: Request) -> ReviewAgentResult:
    pid = patient_of(fid)
    store.investigation(fid)  # 404 for an unknown patient or finding
    current = store.findings(pid).case_version
    if req.case_version != current:
        raise Conflict("stale_case_version", pid, req.case_version, current)
    off = None if agent_limit.allow(client_ip(request)) else "rate_limited"
    return run_review_agent(store, fid, llm_from_env(), llm_off=off)


@app.get("/patients/{pid}/packet")
def packet(pid: str) -> PacketResponse:
    return store.packet(pid)


@app.post("/sandbox/reset")
def reset() -> ResetResponse:
    store.reset()
    return ResetResponse(reset=True, patients=store.patients())
