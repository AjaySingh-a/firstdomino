"""FastAPI routes. FD_STORE=graph (the docker-compose default) reads and writes FalkorDB through
GraphStore (api/graph_store.py), which checks the patient exists in a family graph before every
patient-scoped call. FD_STORE=fixtures (the default without compose) serves data/stories from memory
through FixtureStore, which also produces the snapshots the web app uses offline.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.graph_store import graph_store_from_env
from api.models import (
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
    ReviewRequest,
    ReviewResult,
    TimelineResponse,
)
from api.store import Conflict, Invalid, NotFound, default_store

app = FastAPI(title="FirstDomino API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("FD_CORS_ORIGINS", "http://localhost:3001").split(","),
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


@app.get("/health")
def health() -> HealthResponse:
    if getattr(store, "mode", "fixtures") == "graph":
        return HealthResponse(status="ok", mode="graph", falkordb="up" if store.falkordb_up() else "down")
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


@app.get("/patients/{pid}/packet")
def packet(pid: str) -> PacketResponse:
    return store.packet(pid)


@app.post("/sandbox/reset")
def reset() -> ResetResponse:
    store.reset()
    return ResetResponse(reset=True, patients=store.patients())
