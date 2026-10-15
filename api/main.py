"""FastAPI stubs. Every route serves the synthetic fixtures through FixtureStore.

TODO(Dev): swap FixtureStore for a graph-backed store with the same methods, and
check that the caller may access the patient before every patient-scoped call.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.models import (
    ConflictError,
    EvidenceRequest,
    EvidenceResult,
    FindingsResponse,
    HealthResponse,
    InvestigationResponse,
    PacketResponse,
    Patient,
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
store = default_store()

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


@app.get("/patients/{pid}/packet")
def packet(pid: str) -> PacketResponse:
    return store.packet(pid)


@app.post("/sandbox/reset")
def reset() -> ResetResponse:
    store.reset()
    return ResetResponse(reset=True, patients=store.patients())
