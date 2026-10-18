"""In-memory fixture store (FD_STORE=fixtures) behind the snapshots the web app uses offline.

It assembles responses from data/stories and mirrors the write contract (409 on a stale
case_version, idempotent event_id, revision n+1 when evidence changes under a reviewed finding).
It does NOT decide finding statuses: that is engine/rules.py, run against FalkorDB by
api/graph_store.py, which is where the real writes happen.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

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
    FindingPath,
    FindingRevision,
    FindingsResponse,
    GraphPath,
    InvestigationResponse,
    MedicationEpisode,
    Observation,
    PacketItem,
    PacketResponse,
    PathEdge,
    PathNode,
    Patient,
    Pattern,
    QueryTraceEntry,
    QuestionRequest,
    QuestionResult,
    ReviewDecision,
    ReviewRequest,
    ReviewResult,
    StoryFixture,
    TimelineResponse,
)
from engine.questions import question_for

REPO = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("FD_DATA_DIR", REPO / "data"))

DISCLAIMER = (
    "Synthetic data. These are possible patterns for a clinician to review, not conclusions "
    "about what led to what. Any change to a medicine is decided by the prescribing clinician."
)

# Which state field travels with which value field.
STATE_FIELD = {"happened_at": "state", "indication": "indication_state"}


class NotFound(Exception):
    pass


class Invalid(Exception):
    pass


class Conflict(Exception):
    def __init__(self, error: str, patient_id: str, sent: int, current: int):
        super().__init__(error)
        self.body = {"error": error, "patient_id": patient_id, "sent": sent, "current": current}


def load_patterns(data_dir: Path = DATA_DIR) -> dict[str, Pattern]:
    out = {}
    for path in sorted((data_dir / "patterns").glob("*.json")):
        pattern = Pattern.model_validate(json.loads(path.read_text(encoding="utf-8")))
        out[pattern.id] = pattern
    return out


def load_stories(data_dir: Path = DATA_DIR) -> dict[str, StoryFixture]:
    out = {}
    for path in sorted((data_dir / "stories").glob("*.json")):
        story = StoryFixture.model_validate_json(path.read_text(encoding="utf-8"))
        out[story.patient.id] = story
    return out


def patient_of(scoped_id: str) -> str:
    return scoped_id.split(":", 1)[0]


# q11's walk: (edge type, points from node i to node i+1).
WALK_EDGES = [
    ("OF", True), ("IN_CLASS", True), ("INDEX", False), ("MARKER", True), ("IN_CLASS", False), ("OF", False),
]


def fact_node(x: MedicationEpisode | Observation) -> PathNode:
    """A patient fact as a path node: an episode is named by its ingredient, a symptom by its label."""
    name = x.ingredient.name if isinstance(x, MedicationEpisode) else x.label
    label = "MedicationEpisode" if isinstance(x, MedicationEpisode) else "Observation"
    return PathNode(label=label, id=x.id, name=name, happened_at=x.happened_at, state=x.state)


class FixtureStore:
    def __init__(self, stories: dict[str, StoryFixture], patterns: dict[str, Pattern]):
        self._pristine = stories
        self.patterns = patterns
        self.reset()

    def reset(self, pid: str | None = None) -> None:
        """Restore every story, or only `pid`'s (its events are forgotten; other stories are kept)."""
        if pid is None:
            self.cases = {p: s.model_copy(deep=True) for p, s in self._pristine.items()}
            self.events: dict[str, EvidenceResult] = {}
            return
        if pid not in self._pristine:
            raise NotFound(f"patient {pid}")
        self.cases[pid] = self._pristine[pid].model_copy(deep=True)
        self.events = {k: v for k, v in self.events.items() if patient_of(k) != pid}

    # ---------- reads ----------

    def case(self, pid: str) -> StoryFixture:
        if pid not in self.cases:
            raise NotFound(f"patient {pid}")
        return self.cases[pid]

    def patients(self) -> list[Patient]:
        return [c.patient for c in self.cases.values()]

    def timeline(self, pid: str) -> TimelineResponse:
        c = self.case(pid)
        return TimelineResponse(
            patient=c.patient,
            sources=c.sources,
            episodes=c.episodes,
            observations=c.observations,
            pending_evidence=c.pending_evidence,
        )

    def findings(self, pid: str) -> FindingsResponse:
        c = self.case(pid)
        return FindingsResponse(
            patient_id=pid, case_version=c.patient.case_version, findings=c.findings
        )

    def _finding(self, fid: str) -> tuple[StoryFixture, Finding]:
        c = self.case(patient_of(fid))
        for f in c.findings:
            if f.id == fid:
                return c, f
        raise NotFound(f"finding {fid}")

    def _facts(self, c: StoryFixture) -> dict[str, MedicationEpisode | Observation]:
        return {x.id: x for x in [*c.episodes, *c.observations]}

    def _fact_refs(self, c: StoryFixture, f: Finding) -> list[FactRef]:
        facts = self._facts(c)
        missing = {
            (r.about_fact_id, r.field): r.id
            for r in c.requirements
            if r.finding_id == f.id and r.state != "provided"
        }
        refs: list[FactRef] = []

        def add(fact, field, label, value, state):
            refs.append(
                FactRef(
                    fact_id=fact.id, field=field, label=label, value=value, state=state,
                    happened_at=fact.happened_at, source_ids=fact.source_ids,
                    requirement_id=missing.get((fact.id, field)),
                )
            )

        for ep_id in (f.index_episode_id, f.marker_episode_id):
            ep = facts[ep_id]
            add(ep, "happened_at", f"{ep.ingredient.name} started", ep.happened_at, ep.state)
        marker = facts[f.marker_episode_id]
        add(marker, "indication", f"Reason {marker.ingredient.name} was started",
            marker.indication, marker.indication_state)
        for obs_id in f.observation_ids:
            o = facts[obs_id]
            add(o, "happened_at", f"{o.label} began", o.happened_at, o.state)
        return refs

    def _investigation_parts(self, c: StoryFixture, f: Finding):
        refs = self._fact_refs(c, f)
        documented = [r for r in refs if r.state in ("documented", "reported") and not r.requirement_id]
        conflicts = [r for r in refs if r.state == "conflicting"]
        unknowns = [r for r in refs if r not in documented and r not in conflicts]
        req_ids = {r.requirement_id for r in unknowns if r.requirement_id}
        open_questions = [
            q for q in c.questions if q.requirement_id in req_ids and q.answer_state is None
        ]
        revisions = sorted([r for r in c.revisions if r.finding_id == f.id], key=lambda r: r.n)
        decisions = [d for d in c.decisions if d.finding_id == f.id]
        return refs, documented, conflicts, unknowns, open_questions, revisions, decisions

    def investigation(self, fid: str) -> InvestigationResponse:
        c, f = self._finding(fid)
        pid = c.patient.id
        refs, documented, conflicts, unknowns, open_qs, revisions, decisions = (
            self._investigation_parts(c, f)
        )
        source_ids = set(f.cited_source_ids) | {s for r in refs for s in r.source_ids}
        params = {"pid": pid, "fid": fid}
        return InvestigationResponse(
            patient_id=pid,
            case_version=c.patient.case_version,
            finding=f,
            pattern=self.patterns[f.pattern_id],
            documented=documented,
            conflicts=conflicts,
            unknowns=unknowns,
            next_question=open_qs[0] if open_qs else None,
            sources=[s for s in c.sources if s.id in source_ids],
            revisions=revisions,
            decisions=decisions,
            query_trace=[
                QueryTraceEntry(
                    query="q4_evidence_pack", params=params, rows=len(refs), mode="fixture",
                    result_ids=list(dict.fromkeys(r.fact_id for r in refs)),
                ),
                QueryTraceEntry(
                    query="q2_next_question", params={"pid": pid}, rows=min(len(open_qs), 1), mode="fixture",
                    result_ids=[q.requirement_id for q in open_qs[:1]],
                ),
                QueryTraceEntry(
                    query="q5_history", params=params, rows=len(revisions), mode="fixture",
                    result_ids=[r.id for r in revisions],
                ),
            ],
        )

    def finding_path(self, fid: str) -> FindingPath:
        """The same shape as q11 in graph mode, built from the story file: fixture mode replays the
        hand-written story and walks nothing."""
        c, f = self._finding(fid)
        pid = c.patient.id
        eps = {e.id: e for e in c.episodes}
        a, b, pat = eps[f.index_episode_id], eps[f.marker_episode_id], self.patterns[f.pattern_id]
        walk = GraphPath(
            nodes=[
                fact_node(a), PathNode(label="Ingredient", name=a.ingredient.name),
                PathNode(label="DrugClass", name=a.ingredient.drug_class),
                PathNode(label="Pattern", id=pat.id, name=pat.title),
                PathNode(label="DrugClass", name=b.ingredient.drug_class),
                PathNode(label="Ingredient", name=b.ingredient.name), fact_node(b),
            ],
            edges=[PathEdge(type=t, forward=fw) for t, fw in WALK_EDGES],
        )
        sides = [
            GraphPath(
                nodes=[PathNode(label="Pattern", id=pat.id, name=pat.title),
                       PathNode(label="Effect", name=pat.via_effect), fact_node(o)],
                edges=[PathEdge(type="VIA", forward=True), PathEdge(type="OF_EFFECT", forward=False)],
            )
            for o in c.observations if o.effect == pat.via_effect
        ]
        return FindingPath(
            patient_id=pid, finding_id=fid, mode="fixture", walk=walk, sides=sides,
            query_trace=[QueryTraceEntry(
                query="q11_finding_path", params={"pid": pid, "fid": fid}, rows=1, mode="fixture",
                result_ids=[n.id for n in walk.nodes if n.id],
            )],
        )

    def packet(self, pid: str) -> PacketResponse:
        c = self.case(pid)
        items = []
        for f in c.findings:
            if f.status == "not_matched":
                continue
            _, documented, conflicts, unknowns, open_qs, revisions, decisions = (
                self._investigation_parts(c, f)
            )
            items.append(PacketItem(
                finding=f, pattern=self.patterns[f.pattern_id], documented=documented,
                conflicts=conflicts, unknowns=unknowns, open_questions=open_qs,
                revisions=revisions, decisions=decisions,
            ))
        return PacketResponse(
            patient=c.patient, case_version=c.patient.case_version, disclaimer=DISCLAIMER, items=items
        )

    # ---------- writes ----------

    def submit_evidence(self, pid: str, req: EvidenceRequest) -> EvidenceResult:
        c = self.case(pid)
        if not req.event_id.startswith(f"{pid}:"):
            raise Invalid(f"event_id {req.event_id} is not scoped to {pid}")
        if req.event_id in self.events:  # idempotent replay, checked before the version
            return self.events[req.event_id].model_copy(update={"replayed": True})
        if req.case_version != c.patient.case_version:
            raise Conflict("stale_case_version", pid, req.case_version, c.patient.case_version)

        change = req.change
        fact = check_change(self._facts(c).get(change.fact_id), change, {s.id for s in c.sources})

        before = fact.model_dump(mode="json")
        mutate(fact, change, c.patient.as_of_day)
        after = fact.model_dump(mode="json")

        req_state = "not_available" if change.state == "not_available" else "provided"
        touched_reqs = set()
        for r in c.requirements:
            if r.about_fact_id == fact.id and r.field in (change.field, value_field(change.field)):
                r.state = req_state
                touched_reqs.add(r.id)
        for q in c.questions:
            if q.requirement_id in touched_reqs:
                q.answer = None if change.value is None else str(change.value)
                q.answer_state = change.state

        affected = [f for f in c.findings if self._touches(c, f, fact.id)]
        findings_before = [f.model_copy(deep=True) for f in affected]
        new_revisions, pending = [], []
        for f in affected:
            if f.status == "reviewed" or any(d.finding_id == f.id for d in c.decisions):
                rev = FindingRevision(
                    id=f"{f.id}:rev-{f.revision_n + 1}", patient_id=pid, finding_id=f.id,
                    n=f.revision_n + 1, status="needs_reassessment",
                    reason=(
                        f"{change_summary(before, after, change.field)} "
                        f"Revision {f.revision_n} was reviewed, so it needs a fresh look."
                    ),
                    changed_fact_ids=[fact.id], created_at=c.patient.as_of_day,
                    previous_n=f.revision_n, eval_version=f.eval_version,
                )
                c.revisions.append(rev)
                f.revision_n = rev.n
                f.status = "needs_reassessment"
                new_revisions.append(rev)
            else:
                pending.append(f.id)  # engine re-evaluates these (Q3 scope)

        c.pending_evidence = [p for p in c.pending_evidence if p.event_id != req.event_id]
        version_before = c.patient.case_version
        c.patient.case_version += 1
        result = EvidenceResult(
            event_id=req.event_id, patient_id=pid, case_version_before=version_before,
            case_version=c.patient.case_version, before=before, after=after,
            affected_finding_ids=[f.id for f in affected], new_revisions=new_revisions,
            finding_changes=[
                FindingChange(finding_id=b.id, before=b, after=a.model_copy(deep=True))
                for b, a in zip(findings_before, affected, strict=True)
            ],
            pending_reevaluation_ids=pending, replayed=False,
        )
        self.events[req.event_id] = result
        return result

    def review(self, fid: str, req: ReviewRequest) -> ReviewResult:
        c, f = self._finding(fid)
        pid = c.patient.id
        if req.case_version != c.patient.case_version:
            raise Conflict("stale_case_version", pid, req.case_version, c.patient.case_version)
        if req.revision_n != f.revision_n:
            raise Conflict("stale_revision", pid, req.revision_n, f.revision_n)
        k = 1 + sum(1 for d in c.decisions if d.finding_id == fid and d.revision_n == f.revision_n)
        decision = ReviewDecision(
            id=f"{fid}:rev-{f.revision_n}:dec-{k}", patient_id=pid, finding_id=fid,
            revision_n=f.revision_n, by_role=req.by_role, decision=req.decision,
            reason=req.reason, decided_at=c.patient.as_of_day,
        )
        c.decisions.append(decision)
        f.status = "reviewed"
        c.patient.case_version += 1
        return ReviewResult(case_version=c.patient.case_version, decision=decision, finding=f)

    def ask_question(self, req: QuestionRequest) -> QuestionResult:
        pid = patient_of(req.requirement_id)
        c = self.case(pid)
        r = next((r for r in c.requirements if r.id == req.requirement_id), None)
        if r is None:
            raise NotFound(f"requirement {req.requirement_id}")
        asked = next((q for q in c.questions if q.requirement_id == r.id and q.asked_at is not None), None)
        if asked:  # already asked: replay, checked before the version
            return QuestionResult(case_version=c.patient.case_version, question=asked, replayed=True)
        if req.case_version != c.patient.case_version:
            raise Conflict("stale_case_version", pid, req.case_version, c.patient.case_version)
        if r.state != "missing":
            raise Invalid(f"requirement {r.id} is {r.state}; there is nothing to ask")
        check_copy(req.text)
        q = next((q for q in c.questions if q.requirement_id == r.id), None)
        if q is None:
            fact = self._facts(c)[r.about_fact_id]
            name = fact.ingredient.name if isinstance(fact, MedicationEpisode) else fact.label.lower()
            q = question_for(pid, r.id, r.kind, name, fact.happened_at)
            c.questions.append(q)
        q.asked_at = c.patient.as_of_day
        if req.text:
            q.text = req.text
        c.patient.case_version += 1
        return QuestionResult(case_version=c.patient.case_version, question=q, replayed=False)

    def affected(self, pid: str, fact_id: str) -> AffectedResponse:
        """Read-only Q3: which findings depend on this fact, and their current status."""
        c = self.case(pid)
        if fact_id not in self._facts(c):
            raise NotFound(f"fact {fact_id}")
        return AffectedResponse(
            patient_id=pid, case_version=c.patient.case_version, fact_id=fact_id,
            findings=[f for f in c.findings if self._touches(c, f, fact_id)],
        )

    def agent_steps(self, pid: str) -> AgentStepsResponse:
        c = self.case(pid)
        return AgentStepsResponse(patient_id=pid, case_version=c.patient.case_version, steps=c.agent_steps)

    def record_agent_step(self, req: AgentStepRequest) -> AgentStepResult:
        pid = patient_of(req.step_id)
        c = self.case(pid)
        existing = next((s for s in c.agent_steps if s.id == req.step_id), None)
        if existing:  # replay, checked before the version
            return AgentStepResult(case_version=c.patient.case_version, step=existing, replayed=True)
        if req.case_version != c.patient.case_version:
            raise Conflict("stale_case_version", pid, req.case_version, c.patient.case_version)
        check_agent_step(pid, req, {f.id for f in c.findings})
        step = AgentStep(
            id=req.step_id, patient_id=pid, finding_id=req.finding_id, tool=req.tool, ok=req.ok,
            args=req.args, result_ids=req.result_ids, at=c.patient.as_of_day,
        )
        c.agent_steps.append(step)  # an audit record: case_version does not move
        return AgentStepResult(case_version=c.patient.case_version, step=step, replayed=False)

    # ---------- helpers ----------

    @staticmethod
    def _touches(c: StoryFixture, f: Finding, fact_id: str) -> bool:
        if fact_id in (f.index_episode_id, f.marker_episode_id) or fact_id in f.observation_ids:
            return True
        return any(r.finding_id == f.id and r.about_fact_id == fact_id for r in c.requirements)


# ---------- the evidence-change rules both stores share ----------

Fact = MedicationEpisode | Observation


def check_change(fact: Fact | None, change: EvidenceChange, source_ids: set[str]) -> Fact:
    if fact is None:
        raise NotFound(f"fact {change.fact_id}")
    if change.field not in type(fact).model_fields:
        raise Invalid(f"{type(fact).__name__} has no field {change.field}")
    if change.source_id and change.source_id not in source_ids:
        raise Invalid(f"unknown source {change.source_id}")
    return fact


# The copy rules (AGENTS.md), applied to text a client sends: agent phrasing never reaches the record
# with these words. Spelled with \s+ so this file passes tests/test_contracts.py::test_copy_rules.
BANNED_COPY = re.compile(r"\bsafe\b|stop\s+taking|\bcleared\b|caused\s+by", re.I)


def check_copy(text: str | None) -> None:
    if text and BANNED_COPY.search(text):
        raise Invalid('text breaks the copy rules: say "possible pattern" or "worth reviewing"')


def check_agent_step(pid: str, req: AgentStepRequest, finding_ids: set[str]) -> None:
    """The agent cites only this patient's IDs, and only findings that exist."""
    if req.finding_id is not None and req.finding_id not in finding_ids:
        raise NotFound(f"finding {req.finding_id}")
    foreign = [i for i in req.result_ids if not i.startswith(f"{pid}:")]
    if foreign:
        raise Invalid(f"result_ids not scoped to {pid}: {', '.join(foreign)}")


def mutate(fact: Fact, change: EvidenceChange, recorded_at: int) -> None:
    """Apply one change to a fact in place. "not available" never overwrites a value and never means "no"."""
    if change.field in ("state", "indication_state"):
        _set_state(fact, change.field, change.state)
    elif change.state == "not_available":
        if change.field in STATE_FIELD:
            _set_state(fact, STATE_FIELD[change.field], "not_available")
    else:
        setattr(fact, change.field, change.value)
        if change.field in STATE_FIELD:
            _set_state(fact, STATE_FIELD[change.field], change.state)
    fact.recorded_at = recorded_at
    if change.source_id and change.source_id not in fact.source_ids:
        fact.source_ids = [*fact.source_ids, change.source_id]


def _set_state(fact: Fact, field: str, state: str) -> None:
    if field == "state" and state == "not_available":
        state = "unknown"  # a fact's own state has no not_available; the requirement records it
    setattr(fact, field, state)


def value_field(field: str) -> str:
    return {"state": "happened_at", "indication_state": "indication"}.get(field, field)


NOT_RECORDED = "not recorded"


def shown(value) -> str:
    """A value as user-facing text. A missing value reads "not recorded", never Python's None."""
    return NOT_RECORDED if value is None or value == "" else str(value)


def change_summary(before: dict, after: dict, field: str) -> str:
    label = before.get("label") or before.get("ingredient", {}).get("name", before["id"])
    vf = value_field(field)
    state_field = STATE_FIELD.get(vf)
    def side(fact: dict) -> str:
        return shown(fact.get(vf)) + (f" ({shown(fact.get(state_field))})" if state_field else "")
    return f"{label}: {vf} changed from {side(before)} to {side(after)}."


def default_store() -> FixtureStore:
    return FixtureStore(load_stories(), load_patterns())
