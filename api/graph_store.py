"""Graph-backed store (FD_STORE=graph). Same methods as FixtureStore; FalkorDB is the only state.

Reads: patients, timeline (Q7), findings (Q6), investigation and packet (Q4, Q2, Q5).
Writes: every check that must hold under concurrency runs inside FalkorDB as a compare-and-set in
ONE named query (write/evidence_apply, write/review), so a stale case_version gets 409 even when two
API processes race. Evidence events live in the graph (EvidenceEvent), so a repeated event_id
replays its stored result after an API or FalkorDB restart too.

Evidence change, in order:
1. replay an applied event_id; else write/evidence_apply: compare-and-set case_version, append a
   FactVersion (old one kept), update the fact, record the event as 'applying' with what steps 2-4
   need (the fact before and after, the findings before).
2. a "not available" answer marks the requirements about that field not_available (never "no").
3. Q3 (q3_affected) names the findings that cite, link or need the fact; the rules re-run for those
   only (engine/evaluate.reevaluate) and each gets FindingRevision n+1, linked by PREVIOUS.
   A finding with a review decision gets needs_reassessment; the decision stays on its revision.
4. the result is stored on the event for replay, and the event becomes 'applied'.
If the same event_id comes back while its event is still 'applying' (the API stopped after step 1),
steps 2-4 resume from what the event holds instead of answering 409. Each of them is idempotent: a
revision already written for this event (BECAUSE) is reused, never written twice.

Questions (POST /questions) and agent steps (POST /agent-steps) are compare-and-set writes too.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from falkordb import FalkorDB
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from api.models import (
    AffectedResponse,
    AgentStep,
    AgentStepRequest,
    AgentStepResult,
    AgentStepsResponse,
    EvidenceChange,
    EvidenceRequest,
    EvidenceResult,
    FactRef,
    Finding,
    FindingChange,
    FindingRevision,
    FindingsResponse,
    Ingredient,
    InvestigationResponse,
    MedicationEpisode,
    Observation,
    PacketItem,
    PacketResponse,
    Patient,
    Pattern,
    QueryTraceEntry,
    Question,
    QuestionRequest,
    QuestionResult,
    ReviewDecision,
    ReviewRequest,
    ReviewResult,
    Source,
    TimelineResponse,
)
from api.store import (
    DISCLAIMER,
    Conflict,
    FixtureStore,
    Invalid,
    NotFound,
    change_summary,
    check_agent_step,
    check_change,
    check_copy,
    load_patterns,
    load_stories,
    mutate,
    patient_of,
    value_field,
)
from engine.db import connect, family_graph, props, run
from engine.evaluate import reevaluate
from engine.loaders.seed import DEFAULT_FAMILY, agent_step_props, fact_props, seed
from engine.questions import question_for

log = logging.getLogger("firstdomino.api")


class GraphStore:
    mode = "graph"

    def __init__(self, db: FalkorDB, fixtures: FixtureStore, family_id: str, story_numbers: list[int]):
        self.db = db
        self.fixtures = fixtures  # the fixture stories seed the graph; nothing is served from them
        self.family_id = family_id
        self.story_numbers = story_numbers
        self._graph_of: dict[str, str] = {}  # patient id -> family graph name
        self._seeded = False  # seeding waits for the first moment FalkorDB is reachable

    # ---------- routing + access ----------

    def _refresh(self) -> None:
        """One store serves one family graph (FD_FAMILY); patient IDs are unique within it.
        Seeds first if that has not happened yet. With FalkorDB unreachable this raises redis'
        ConnectionError, which the API answers with 503, never with an empty list."""
        if not self._seeded:
            self._seed()
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

    def appendonly(self) -> str:
        """FalkorDB's AOF setting ("yes" / "no"), or "unknown" when CONFIG is not available."""
        try:
            value = self.db.connection.config_get("appendonly").get("appendonly")
        except Exception:
            return "unknown"
        return value if value in ("yes", "no") else "unknown"

    def _stories(self):
        by_number = {s.story_id.removeprefix("story-"): s for s in load_stories().values()}
        return [by_number[str(n)] for n in self.story_numbers]

    def _seed(self) -> None:
        if self.story_numbers:
            seed(self.db, self.family_id, self._stories(), list(self.fixtures.patterns.values()))
        self._seeded = True

    def ensure_seeded(self) -> None:
        """Load any configured story that is not in the graph yet. Patients already there are kept as
        they are, so a restart never overwrites confirmed evidence."""
        self._seed()
        self._refresh()

    # ---------- reads ----------

    def patients(self) -> list[Patient]:
        self._refresh()
        out = []
        for name in sorted(set(self._graph_of.values())):
            for r in run(self.db.select_graph(name), "admin/patients_in_graph"):
                out.append(_patient(props(r["p"])))
        return sorted(out, key=lambda p: p.id)

    def _patient(self, pid: str) -> Patient:
        for p in self.patients():
            if p.id == pid:
                return p
        raise NotFound(f"patient {pid}")

    def _timeline(self, pid: str) -> tuple[TimelineResponse, dict[str, int]]:
        """The timeline, plus each fact's current version number."""
        g = self._graph(pid)
        sources, episodes, observations, pending, versions = [], [], [], [], {}
        rows = run(g, "q7_timeline", pid=pid)
        for r in rows:
            if r["kind"] == "source":
                sources.append(_source(r["node"]))
        day = {s.id: (s.happened_at if s.happened_at is not None else s.recorded_at, s.id) for s in sources}
        for r in rows:
            n = props(r["node"])
            source_ids = sorted(r["source_ids"], key=lambda sid: day.get(sid, (0, sid)))
            if r["kind"] == "episode":
                versions[n["id"]] = n.get("version", 1)
                episodes.append(MedicationEpisode(
                    id=n["id"], patient_id=pid, happened_at=n.get("happened_at"),
                    recorded_at=n["recorded_at"], state=n["state"], source_ids=source_ids,
                    ingredient=Ingredient(name=r["ingredient"], rxcui=r["rxcui"], drug_class=r["drug_class"]),
                    dose_text=n["dose_text"], indication=n.get("indication"),
                    indication_state=n["indication_state"], stop_day=n.get("stop_day"),
                    prescriber_specialty=r["extra"],
                ))
            elif r["kind"] == "observation":
                versions[n["id"]] = n.get("version", 1)
                observations.append(Observation(
                    id=n["id"], patient_id=pid, happened_at=n.get("happened_at"),
                    recorded_at=n["recorded_at"], state=n["state"], source_ids=source_ids,
                    label=n["label"], effect=r["extra"],
                ))
            elif r["kind"] == "pending":
                pending.append(EvidenceRequest(
                    event_id=n["id"], case_version=n["case_version"],
                    change=EvidenceChange.model_validate_json(n["change"]),
                ))
        timeline = TimelineResponse(
            patient=self._patient(pid),
            sources=sorted(sources, key=lambda s: day[s.id]),
            episodes=sorted(episodes, key=lambda e: e.id),
            observations=sorted(observations, key=lambda o: o.id),
            pending_evidence=sorted(pending, key=lambda e: e.event_id),
        )
        return timeline, versions

    def timeline(self, pid: str) -> TimelineResponse:
        return self._timeline(pid)[0]

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
        q5 = run(g, "q5_history", **params)
        revisions, decisions = _history(pid, fid, q5)

        next_q, asked = None, []
        if q2 and fid in q2[0]["finding_ids"]:
            row = q2[0]
            name, day = pack["names"][row["fact_id"]]
            next_q = question_for(pid, row["requirement_id"], row["requirement"], name, day)
        else:  # Q2 skips asked requirements: show this finding's asked, still unanswered question
            q9 = run(g, "q9_requirements", pid=pid)
            asked = [
                r for r in q9 if r["q"] is not None and r["state"] == "missing" and fid in r["finding_ids"]
            ]
            if asked:
                next_q = _question(props(asked[0]["q"]))

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
                query="q5_history", params=params, rows=len(q5), mode="live",
                result_ids=[r.id for r in revisions],
            ),
        ]
        if asked:
            trace.append(QueryTraceEntry(
                query="q9_requirements", params={"pid": pid}, rows=len(asked), mode="live",
                result_ids=[r["requirement_id"] for r in asked],
            ))
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

    # ---------- writes ----------

    def _event(self, g, pid: str, event_id: str) -> dict:
        rows = run(g, "q8_evidence_event", pid=pid, event_id=event_id)
        return props(rows[0]["e"]) if rows else {}

    @staticmethod
    def _replay(e: dict) -> EvidenceResult | None:
        if e.get("status") != "applied":
            return None
        return EvidenceResult.model_validate_json(e["result"]).model_copy(update={"replayed": True})

    @staticmethod
    def _resumable(e: dict) -> bool:
        """Applied to the fact, stopped before its revisions were finished. Older events (written before
        the event kept its before/after) cannot be resumed and are answered as before."""
        return e.get("status") == "applying" and "findings_before" in e

    def submit_evidence(self, pid: str, req: EvidenceRequest) -> EvidenceResult:
        g = self._graph(pid)
        if not req.event_id.startswith(f"{pid}:"):
            raise Invalid(f"event_id {req.event_id} is not scoped to {pid}")
        e = self._event(g, pid, req.event_id)
        if replay := self._replay(e):  # checked before the version, like the stub
            return replay
        if self._resumable(e):  # its case_version has moved on because of this very event
            return self._finish(g, pid, req.event_id, e)
        timeline, versions = self._timeline(pid)
        patient = timeline.patient
        if req.case_version != patient.case_version:
            raise Conflict("stale_case_version", pid, req.case_version, patient.case_version)

        change = req.change
        facts = {x.id: x for x in [*timeline.episodes, *timeline.observations]}
        fact = check_change(facts.get(change.fact_id), change, {s.id for s in timeline.sources})
        after = fact.model_copy(deep=True)
        mutate(after, change, patient.as_of_day)
        findings_before = self.findings(pid).findings

        n = versions[fact.id]
        rows = run(
            g, "write/evidence_apply", pid=pid, fact_id=fact.id, case_version=req.case_version,
            fact_props={**fact_props(after), "version": n + 1},
            old_id=f"{fact.id}:ver-{n}", old_props=_version_props(fact, n),
            new_props={**_version_props(after, n + 1), "event_id": req.event_id},
            recorded_at=patient.as_of_day, event_id=req.event_id,
            event_props={
                "patient_id": pid, "status": "applying", "case_version": req.case_version,
                "change": change.model_dump_json(), "recorded_at": patient.as_of_day,
                "before": fact.model_dump_json(), "after": after.model_dump_json(),
                "findings_before": json.dumps([f.model_dump(mode="json") for f in findings_before]),
            },
        )
        e = self._event(g, pid, req.event_id)
        if not rows:  # lost the compare-and-set: same event sent twice at once, or another write won
            if replay := self._replay(e):
                return replay
            if self._resumable(e):
                return self._finish(g, pid, req.event_id, e)
            current = self._patient(pid).case_version
            raise Conflict("stale_case_version", pid, req.case_version, current)
        return self._finish(g, pid, req.event_id, e)

    def _finish(self, g, pid: str, event_id: str, e: dict) -> EvidenceResult:
        """Steps 2-4 for an event that is applied to its fact. Running it again for the same event
        writes nothing twice."""
        change = EvidenceChange.model_validate_json(e["change"])
        before_dump, after_dump = json.loads(e["before"]), json.loads(e["after"])
        findings_before = {f["id"]: Finding.model_validate(f) for f in json.loads(e["findings_before"])}
        fact_id, recorded_at = change.fact_id, e["recorded_at"]

        if change.source_id:
            run(g, "write/fact_sources", pid=pid, id=fact_id, source_ids=[change.source_id])
        if change.state == "not_available":
            run(g, "write/requirement_not_available", pid=pid, fact_id=fact_id,
                fields=sorted({change.field, value_field(change.field)}))

        affected = sorted(r["finding"] for r in run(g, "q3_affected", pid=pid, fact_id=fact_id))
        summary = change_summary(before_dump, after_dump, change.field)
        reviewed, leads = {}, {}
        for fid in affected:
            f = findings_before[fid]
            reviewed[fid] = any(r["decisions"] for r in run(g, "q5_history", pid=pid, fid=fid))
            leads[fid] = summary + (
                f" Revision {f.revision_n} was reviewed, so it needs a fresh look." if reviewed[fid]
                else " Re-evaluated."
            )
        targets = {fid: (findings_before[fid].index_episode_id, findings_before[fid].marker_episode_id)
                   for fid in affected}
        evaluations = reevaluate(g, pid, targets, leads)

        new_revisions = []
        for fid, ev in evaluations.items():
            prev_n = findings_before[fid].revision_n
            rev = _revision_for_event(g, pid, fid, event_id)
            if rev is None:
                rows = run(
                    g, "write/revision_next", pid=pid, fid=fid, prev_n=prev_n,
                    rev_id=f"{fid}:rev-{prev_n + 1}", n=prev_n + 1,
                    status="needs_reassessment" if reviewed[fid] else ev.status,
                    reason=ev.reason, changed_fact_ids=[fact_id], created_at=recorded_at,
                    eval_version=ev.eval_version, headline=ev.headline, event_id=event_id,
                )
                # No row: a concurrent finish of the same event wrote it first.
                rev = props(rows[0]["rev"]) if rows else _revision_for_event(g, pid, fid, event_id)
                if rev is None:
                    raise RuntimeError(f"no revision for {fid} after {event_id}")
            new_revisions.append(_revision(pid, fid, rev, prev_n))

        findings_after = {f.id: f for f in self.findings(pid).findings}
        result = EvidenceResult(
            event_id=event_id, patient_id=pid, case_version_before=e["case_version"],
            case_version=e["case_version"] + 1, before=before_dump, after=after_dump,
            affected_finding_ids=affected, new_revisions=new_revisions,
            finding_changes=[
                FindingChange(finding_id=fid, before=findings_before[fid], after=findings_after[fid])
                for fid in affected
            ],
            pending_reevaluation_ids=[], replayed=False,
        )
        run(g, "write/evidence_done", pid=pid, event_id=event_id, result=result.model_dump_json())
        return result

    def review(self, fid: str, req: ReviewRequest) -> ReviewResult:
        pid = patient_of(fid)
        g = self._graph(pid)
        patient = self._patient(pid)
        rows = run(
            g, "write/review", pid=pid, fid=fid, case_version=req.case_version, revision_n=req.revision_n,
            by_role=req.by_role, decision=req.decision, reason=req.reason, decided_at=patient.as_of_day,
        )
        current = {f.id: f for f in self.findings(pid).findings}
        if fid not in current:
            raise NotFound(f"finding {fid}")
        if not rows:  # lost the compare-and-set: say which check failed
            now = self._patient(pid).case_version
            if req.case_version != now:
                raise Conflict("stale_case_version", pid, req.case_version, now)
            raise Conflict("stale_revision", pid, req.revision_n, current[fid].revision_n)
        return ReviewResult(
            case_version=rows[0]["case_version"], decision=_decision(pid, fid, props(rows[0]["dec"])),
            finding=current[fid],
        )

    def ask_question(self, req: QuestionRequest) -> QuestionResult:
        pid = patient_of(req.requirement_id)
        g = self._graph(pid)
        rows = {r["requirement_id"]: r for r in run(g, "q9_requirements", pid=pid)}
        row = rows.get(req.requirement_id)
        if row is None:
            raise NotFound(f"requirement {req.requirement_id}")
        patient = self._patient(pid)
        if row["q"] is not None:  # already asked: replay, checked before the version
            return QuestionResult(case_version=patient.case_version, question=_question(props(row["q"])),
                                  replayed=True)
        if req.case_version != patient.case_version:
            raise Conflict("stale_case_version", pid, req.case_version, patient.case_version)
        if row["state"] != "missing":
            raise Invalid(f"requirement {req.requirement_id} is {row['state']}; there is nothing to ask")
        check_copy(req.text)
        q = question_for(pid, req.requirement_id, row["kind"], row["name"], row["day"])
        q = q.model_copy(update={"asked_at": patient.as_of_day, **({"text": req.text} if req.text else {})})
        out = run(g, "write/question", pid=pid, rid=req.requirement_id, case_version=req.case_version,
                  props=q.model_dump(exclude_none=True))
        if not out:  # lost the compare-and-set: asked at the same moment, or another write won
            return self.ask_question(req)
        return QuestionResult(case_version=out[0]["case_version"], question=_question(props(out[0]["q"])),
                              replayed=False)

    def affected(self, pid: str, fact_id: str) -> AffectedResponse:
        """Read-only Q3: which findings depend on this fact, and their current status."""
        timeline = self.timeline(pid)  # also the access check
        if fact_id not in {x.id for x in [*timeline.episodes, *timeline.observations]}:
            raise NotFound(f"fact {fact_id}")
        ids = {r["finding"] for r in run(self._graph(pid), "q3_affected", pid=pid, fact_id=fact_id)}
        current = self.findings(pid)
        return AffectedResponse(
            patient_id=pid, case_version=current.case_version, fact_id=fact_id,
            findings=[f for f in current.findings if f.id in ids],
        )

    def agent_steps(self, pid: str) -> AgentStepsResponse:
        g = self._graph(pid)
        steps = [_agent_step(props(r["s"]), r["finding_id"]) for r in run(g, "q10_agent_steps", pid=pid)]
        return AgentStepsResponse(patient_id=pid, case_version=self._patient(pid).case_version, steps=steps)

    def record_agent_step(self, req: AgentStepRequest) -> AgentStepResult:
        pid = patient_of(req.step_id)
        existing = {s.id: s for s in self.agent_steps(pid).steps}  # also the access check
        patient = self._patient(pid)
        if req.step_id in existing:  # replay, checked before the version
            return AgentStepResult(
                case_version=patient.case_version, step=existing[req.step_id], replayed=True,
            )
        if req.case_version != patient.case_version:
            raise Conflict("stale_case_version", pid, req.case_version, patient.case_version)
        check_agent_step(pid, req, {f.id for f in self.findings(pid).findings})
        step = AgentStep(
            id=req.step_id, patient_id=pid, finding_id=req.finding_id, tool=req.tool, ok=req.ok,
            args=req.args, result_ids=req.result_ids, at=patient.as_of_day,
        )
        rows = run(self._graph(pid), "write/agent_step", pid=pid, case_version=req.case_version, id=step.id,
                   fid=step.finding_id, props=agent_step_props(step))
        if not rows:
            raise Conflict("stale_case_version", pid, req.case_version, self._patient(pid).case_version)
        return AgentStepResult(case_version=patient.case_version, step=step, replayed=False)

    def reset(self, pid: str | None = None) -> None:
        """Drop and re-seed kb_template and the configured family graph from the fixtures. With `pid`,
        delete only that patient's subgraph (admin/drop_patient) and seed its story again; the other
        patients and the shared knowledge are left as they are."""
        if pid is None:
            self.fixtures.reset()
            seed(self.db, self.family_id, self._stories(), list(self.fixtures.patterns.values()), reset=True)
            self._seeded = True
            self._refresh()
            return
        story = next((s for s in self._stories() if s.patient.id == pid), None)
        if story is None:
            raise NotFound(f"patient {pid}")
        run(self._graph(pid), "admin/drop_patient", pid=pid)
        self.fixtures.reset(pid)
        seed(self.db, self.family_id, [story], list(self.fixtures.patterns.values()))
        self._refresh()


# ---------- row -> contract ----------


def _patient(p: dict) -> Patient:
    return Patient(
        id=p["id"], label=p["label"], age_band=p["age_band"], case_version=p["case_version"],
        as_of_day=p["as_of_day"], synthetic=p["synthetic"],
    )


def _version_props(fact: MedicationEpisode | Observation, n: int) -> dict:
    """A FactVersion holds the fact's stored properties plus its sources at that version."""
    return {**fact_props(fact), "id": f"{fact.id}:ver-{n}", "fact_id": fact.id, "n": n,
            "source_ids": fact.source_ids}


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


def _revision(pid: str, fid: str, rev: dict, previous_n: int | None) -> FindingRevision:
    return FindingRevision(
        id=rev["id"], patient_id=pid, finding_id=fid, n=rev["n"], status=rev["status"],
        reason=rev["reason"], changed_fact_ids=rev.get("changed_fact_ids", []),
        created_at=rev["created_at"], previous_n=previous_n, eval_version=rev["eval_version"],
    )


def _decision(pid: str, fid: str, d: dict) -> ReviewDecision:
    return ReviewDecision(
        id=d["id"], patient_id=pid, finding_id=fid, revision_n=d["revision_n"], by_role=d["by_role"],
        decision=d["decision"], reason=d["reason"], decided_at=d["decided_at"],
    )


def _revision_for_event(g, pid: str, fid: str, event_id: str) -> dict | None:
    """The revision of this finding that this evidence event already wrote (BECAUSE), if any."""
    for r in run(g, "q5_history", pid=pid, fid=fid):
        if event_id in r["event_ids"]:
            return props(r["rev"])
    return None


def _question(q: dict) -> Question:
    return Question(
        id=q["id"], patient_id=q["patient_id"], requirement_id=q["requirement_id"], ask_role=q["ask_role"],
        text=q["text"], asked_at=q.get("asked_at"), answer=q.get("answer"),
        answer_state=q.get("answer_state"),
    )


def _agent_step(s: dict, finding_id: str | None) -> AgentStep:
    return AgentStep(
        id=s["id"], patient_id=s["patient_id"], finding_id=finding_id, tool=s["tool"], ok=s["ok"],
        args=json.loads(s["args_json"]), result_ids=s.get("result_ids", []), at=s["at"],
    )


def _history(pid: str, fid: str, rows: list[dict[str, Any]]):
    revisions, decisions = [], []
    for r in rows:
        rev = props(r["rev"])
        revisions.append(_revision(pid, fid, rev, r["previous_n"]))
        decisions += sorted((_decision(pid, fid, props(d)) for d in r["decisions"]), key=lambda d: d.id)
    return revisions, decisions


def graph_store_from_env(fixtures: FixtureStore | None = None) -> GraphStore:
    numbers = [int(n) for n in os.environ.get("FD_STORIES", "1").replace(",", " ").split()]
    db = connect()
    store = GraphStore(
        db, fixtures or FixtureStore(load_stories(), load_patterns()),
        os.environ.get("FD_FAMILY", DEFAULT_FAMILY), numbers,
    )
    deadline = time.monotonic() + float(os.environ.get("FD_DB_WAIT_SECONDS", "30"))
    while True:  # FalkorDB may still be starting (compose and Railway start both services together)
        try:
            db.connection.ping()
            store.ensure_seeded()
            return store
        except (RedisConnectionError, RedisTimeoutError):
            if time.monotonic() > deadline:
                # Boot anyway: /health says "degraded", data routes answer 503, and the first request
                # that reaches FalkorDB seeds it. The error is not logged: it may name the host.
                log.warning("FalkorDB not reachable at boot; the API will answer 503 until it is")
                return store
            time.sleep(1)
