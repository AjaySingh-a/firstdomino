"""Graph-backed store (FD_STORE=graph). Same methods as FixtureStore.

D-1 scope: patients, findings, investigation and packet are read from FalkorDB through the named
queries. The timeline is still served from the fixtures (the graph holds the same facts until D-2
adds writes). Evidence and review writes return 501 in graph mode until D-2 moves the 409 /
event_id / revision logic into the graph.
"""

from __future__ import annotations

import json
import os
from typing import Any

from falkordb import FalkorDB

from api.models import (
    EvidenceRequest,
    EvidenceResult,
    FactRef,
    Finding,
    FindingRevision,
    FindingsResponse,
    InvestigationResponse,
    PacketItem,
    PacketResponse,
    Patient,
    Pattern,
    QueryTraceEntry,
    ReviewDecision,
    ReviewRequest,
    ReviewResult,
    Source,
    TimelineResponse,
)
from api.store import DISCLAIMER, FixtureStore, NotFound, load_patterns, load_stories, patient_of
from engine.db import connect, family_graph, props, run
from engine.loaders.seed import DEFAULT_FAMILY, seed
from engine.questions import question_for


class NotInGraphMode(Exception):
    pass


class GraphStore:
    mode = "graph"

    def __init__(self, db: FalkorDB, fixtures: FixtureStore, family_id: str, story_numbers: list[int]):
        self.db = db
        self.fixtures = fixtures
        self.family_id = family_id
        self.story_numbers = story_numbers
        self._graph_of: dict[str, str] = {}  # patient id -> family graph name

    # ---------- routing + access ----------

    def _refresh(self) -> None:
        """One store serves one family graph (FD_FAMILY); patient IDs are unique within it."""
        self._graph_of = {}
        name = family_graph(self.family_id)
        if name in self.db.list_graphs():
            for r in run(self.db.select_graph(name), "admin/patients_in_graph"):
                self._graph_of[props(r["p"])["id"]] = name

    def _graph(self, pid: str):
        """The caller-may-access-this-patient check. No auth yet: the patient must exist in a graph."""
        if pid not in self._graph_of:
            self._refresh()
        if pid not in self._graph_of:
            raise NotFound(f"patient {pid}")
        return self.db.select_graph(self._graph_of[pid])

    def falkordb_up(self) -> bool:
        try:
            return bool(self.db.connection.ping())
        except Exception:
            return False

    def ensure_seeded(self) -> None:
        self._refresh()
        if not self._graph_of:
            self.reset()

    # ---------- reads ----------

    def patients(self) -> list[Patient]:
        self._refresh()
        out = []
        for name in sorted(set(self._graph_of.values())):
            for r in run(self.db.select_graph(name), "admin/patients_in_graph"):
                out.append(Patient.model_validate(props(r["p"])))
        return sorted(out, key=lambda p: p.id)

    def _patient(self, pid: str) -> Patient:
        for p in self.patients():
            if p.id == pid:
                return p
        raise NotFound(f"patient {pid}")

    def timeline(self, pid: str) -> TimelineResponse:
        self._graph(pid)
        return self.fixtures.timeline(pid)

    def findings(self, pid: str) -> FindingsResponse:
        g = self._graph(pid)
        rows = run(g, "q6_patient_findings", pid=pid)
        findings = [
            _finding(
                props(r["f"]), r["pattern_id"], r["effect"], r["index_ep"], r["marker_ep"],
                r["observation_ids"], [_source(s) for s in r["sources"]], r["requirement_ids"],
            )
            for r in rows
        ]
        return FindingsResponse(
            patient_id=pid, case_version=self._patient(pid).case_version, findings=findings
        )

    def _parts(self, fid: str):
        pid = patient_of(fid)
        g = self._graph(pid)
        params = {"pid": pid, "fid": fid}
        q4 = run(g, "q4_evidence_pack", **params)
        if not q4:
            raise NotFound(f"finding {fid}")
        pack = _evidence_pack(q4)
        q2 = run(g, "q2_next_question", pid=pid)
        q5 = run(g, "q5_review_history", **params)
        revisions, decisions = _history(pid, fid, q5)

        next_q = None
        if q2 and fid in q2[0]["finding_ids"]:
            row = q2[0]
            name, day = pack["names"][row["fact_id"]]
            next_q = question_for(pid, row["requirement_id"], row["requirement"], name, day)

        trace = [
            QueryTraceEntry(
                query="q4_evidence_pack", params=params, rows=len(q4), mode="live",
                result_ids=[props(r["fact"])["id"] for r in q4],
            ),
            QueryTraceEntry(
                query="q2_next_question", params={"pid": pid}, rows=len(q2), mode="live",
                result_ids=[r["requirement_id"] for r in q2],
            ),
            QueryTraceEntry(
                query="q5_review_history", params=params, rows=len(q5), mode="live",
                result_ids=[r.id for r in revisions],
            ),
        ]
        return pid, pack, next_q, revisions, decisions, trace

    def investigation(self, fid: str) -> InvestigationResponse:
        pid, pack, next_q, revisions, decisions, trace = self._parts(fid)
        return InvestigationResponse(
            patient_id=pid, case_version=self._patient(pid).case_version, finding=pack["finding"],
            pattern=pack["pattern"], documented=pack["documented"], conflicts=pack["conflicts"],
            unknowns=pack["unknowns"], next_question=next_q, sources=pack["sources"],
            revisions=revisions, decisions=decisions, query_trace=trace,
        )

    def packet(self, pid: str) -> PacketResponse:
        patient = self._patient(pid)
        items = []
        for f in self.findings(pid).findings:
            if f.status == "not_matched":
                continue
            _, pack, next_q, revisions, decisions, _ = self._parts(f.id)
            items.append(PacketItem(
                finding=pack["finding"], pattern=pack["pattern"], documented=pack["documented"],
                conflicts=pack["conflicts"], unknowns=pack["unknowns"],
                open_questions=[next_q] if next_q else [], revisions=revisions, decisions=decisions,
            ))
        return PacketResponse(
            patient=patient, case_version=patient.case_version, disclaimer=DISCLAIMER, items=items
        )

    # ---------- writes (D-2) ----------

    def submit_evidence(self, pid: str, req: EvidenceRequest) -> EvidenceResult:
        self._graph(pid)
        raise NotInGraphMode("evidence writes move into FalkorDB in D-2")

    def review(self, fid: str, req: ReviewRequest) -> ReviewResult:
        self._graph(patient_of(fid))
        raise NotInGraphMode("review writes move into FalkorDB in D-2")

    def reset(self) -> None:
        """Drop and re-seed kb_template and the configured family graph from the fixtures."""
        self.fixtures.reset()
        by_number = {s.story_id.removeprefix("story-"): s for s in load_stories().values()}
        stories = [by_number[str(n)] for n in self.story_numbers]
        seed(self.db, self.family_id, stories, list(self.fixtures.patterns.values()), reset=True)
        self._refresh()


# ---------- row -> contract ----------


def _source(node: Any) -> Source:
    p = props(node)
    return Source(
        id=p["id"], patient_id=p["patient_id"], kind=p["kind"], label=p["label"],
        happened_at=p.get("happened_at"), recorded_at=p["recorded_at"],
    )


def _sorted_sources(sources: list[Source]) -> list[Source]:
    unique = {s.id: s for s in sources}.values()
    return sorted(unique, key=lambda s: (s.happened_at if s.happened_at is not None else s.recorded_at, s.id))


def _finding(f: dict, pattern_id, effect, index_ep, marker_ep, obs_ids, sources, req_ids) -> Finding:
    return Finding(
        id=f["id"], patient_id=f["patient_id"], pattern_id=pattern_id,
        pattern_version=f["pattern_version"], eval_version=f["eval_version"], status=f["status"],
        revision_n=f["revision_n"], index_episode_id=index_ep, marker_episode_id=marker_ep,
        effect=effect, observation_ids=sorted(obs_ids),
        cited_source_ids=[s.id for s in _sorted_sources(sources)], requirement_ids=sorted(req_ids),
        headline=f["headline"],
    )


def _evidence_pack(rows: list[dict[str, Any]]) -> dict[str, Any]:
    first = rows[0]
    f, pat = props(first["f"]), props(first["pat"])
    pattern = Pattern(
        id=pat["id"], version=pat["version"], title=pat["title"], index_class=first["index_class"],
        via_effect=first["via_effect"], marker_class=first["marker_class"],
        window_days=pat["window_days"], requires=pat["requires"],
        evidence_refs=json.loads(pat["evidence_refs"]),
    )
    by_role: dict[str, list[dict]] = {"FROM": [], "TO": [], "CITES": []}
    sources: list[Source] = []
    open_req: dict[tuple[str, str], str] = {}  # (fact_id, field) -> requirement id
    req_ids: list[str] = []
    names: dict[str, tuple[str, int | None]] = {}
    for r in rows:
        fact = props(r["fact"])
        fact_sources = [_source(s) for s in r["sources"]]
        sources += fact_sources
        source_ids = [s.id for s in _sorted_sources(fact_sources)]
        item = {**fact, "_ingredient": r["ingredient"], "_source_ids": source_ids}
        by_role[r["role"]].append(item)
        names[fact["id"]] = (r["ingredient"] or fact.get("label", "").lower(), fact.get("happened_at"))
        for rid, _kind, fld, state in r["requirements"]:
            if rid is None:  # collect() over an empty OPTIONAL MATCH
                continue
            req_ids.append(rid)
            if state != "provided":
                open_req[(fact["id"], fld)] = rid

    refs: list[FactRef] = []

    def add(fact: dict, fld: str, label: str, value, state: str) -> None:
        refs.append(FactRef(
            fact_id=fact["id"], field=fld, label=label, value=value, state=state,
            happened_at=fact.get("happened_at"), source_ids=fact["_source_ids"],
            requirement_id=open_req.get((fact["id"], fld)),
        ))

    index, marker = by_role["FROM"][0], by_role["TO"][0]
    for ep in (index, marker):
        add(ep, "happened_at", f"{ep['_ingredient']} started", ep.get("happened_at"),
            ep.get("state", "unknown"))
    add(marker, "indication", f"Reason {marker['_ingredient']} was started",
        marker.get("indication"), marker.get("indication_state", "unknown"))
    observations = [x for x in by_role["CITES"] if x["id"].split(":", 1)[1].startswith("obs-")]
    for o in observations:
        add(o, "happened_at", f"{o['label']} began", o.get("happened_at"), o.get("state", "unknown"))
    if (index["id"], "via_effect") in open_req:  # no observation recorded yet: not known, not "no"
        effect = first["via_effect"].replace("_", " ")
        add(index, "via_effect", f"Whether {effect} was noticed after {index['_ingredient']} started",
            None, "unknown")

    documented = [r for r in refs if r.state in ("documented", "reported") and not r.requirement_id]
    conflicts = [r for r in refs if r.state == "conflicting"]
    unknowns = [r for r in refs if r not in documented and r not in conflicts]
    finding = _finding(
        f, pat["id"], first["via_effect"], index["id"], marker["id"], [o["id"] for o in observations],
        sources, sorted(set(req_ids)),
    )
    return {
        "finding": finding, "pattern": pattern, "documented": documented, "conflicts": conflicts,
        "unknowns": unknowns, "sources": _sorted_sources(sources), "names": names,
    }


def _history(pid: str, fid: str, rows: list[dict[str, Any]]):
    revisions, decisions = [], []
    for r in rows:
        rev = props(r["rev"])
        revisions.append(FindingRevision(
            id=rev["id"], patient_id=pid, finding_id=fid, n=rev["n"], status=rev["status"],
            reason=rev["reason"], changed_fact_ids=rev.get("changed_fact_ids", []),
            created_at=rev["created_at"], previous_n=r["previous_n"], eval_version=rev["eval_version"],
        ))
        for d in r["decisions"]:
            d = props(d)
            decisions.append(ReviewDecision(
                id=d["id"], patient_id=pid, finding_id=fid, revision_n=rev["n"], by_role=d["by_role"],
                decision=d["decision"], reason=d["reason"], decided_at=d["decided_at"],
            ))
    return revisions, decisions


def graph_store_from_env(fixtures: FixtureStore | None = None) -> GraphStore:
    numbers = [int(n) for n in os.environ.get("FD_STORIES", "1").replace(",", " ").split()]
    store = GraphStore(
        connect(), fixtures or FixtureStore(load_stories(), load_patterns()),
        os.environ.get("FD_FAMILY", DEFAULT_FAMILY), numbers,
    )
    store.ensure_seeded()
    return store

