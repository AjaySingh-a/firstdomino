"""Contract types. Mirrored by hand in web/lib/types.ts (tests/test_contracts.py checks the field names).

Conventions:
- Story time is a day number (int). Day 0 is the first event in the story.
- Every fact carries happened_at (day or None), recorded_at (day) and a state.
- Every ID is patient-scoped: "<patient_id>:<local id>".
- No status here means "caused". Findings are possible patterns for a clinician to review.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Day = int

FactState = Literal["documented", "reported", "conflicting", "unknown"]
# An answer can also be not_available, which is never treated as "no".
AnswerState = Literal["documented", "reported", "conflicting", "unknown", "not_available"]
FindingStatus = Literal[
    "candidate",
    "needs_evidence",
    "competing_explanation",
    "needs_reassessment",
    "reviewed",
    "not_matched",
]
RequirementKind = Literal["start_day", "onset_day", "indication", "order"]
RequirementState = Literal["missing", "provided", "not_available"]
SourceKind = Literal[
    "clinic_letter",
    "discharge_summary",
    "pharmacy_record",
    "gp_note",
    "caregiver_report",
]
ReviewerRole = Literal["clinician", "pharmacist"]
ReviewChoice = Literal["follow_up", "no_action", "defer"]
AskRole = Literal["caregiver", "prescriber", "pharmacist"]
AgentTool = Literal[
    "get_investigation",
    "get_next_question",
    "draft_question_text",
    "draft_packet_text",
]
EditableField = Literal["happened_at", "state", "indication", "indication_state", "stop_day"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


# ---------- knowledge ----------


class EvidenceRef(Model):
    citation: str
    doi: str | None = None
    url: str | None = None
    note: str | None = None


class Pattern(Model):
    id: str
    version: int
    title: str
    index_class: str  # DrugClass.code of the first medicine
    via_effect: str  # Effect.name
    marker_class: str  # DrugClass.code of the second medicine
    window_days: int
    requires: list[RequirementKind]
    evidence_refs: list[EvidenceRef]


class Ingredient(Model):
    name: str
    rxcui: str
    drug_class: str


# ---------- patient facts ----------


class Patient(Model):
    id: str
    label: str
    age_band: str
    case_version: int
    as_of_day: Day
    synthetic: Literal[True] = True


class Source(Model):
    id: str
    patient_id: str
    kind: SourceKind
    label: str
    happened_at: Day | None
    recorded_at: Day


class Fact(Model):
    id: str
    patient_id: str
    happened_at: Day | None
    recorded_at: Day
    state: FactState
    source_ids: list[str]


class MedicationEpisode(Fact):
    """happened_at = start day; state = state of the start day."""

    ingredient: Ingredient
    dose_text: str
    indication: str | None
    indication_state: AnswerState
    stop_day: Day | None
    prescriber_specialty: str | None


class Observation(Fact):
    """happened_at = onset day; state = state of the onset day."""

    label: str
    effect: str


# ---------- reasoning ----------


class EvidenceRequirement(Model):
    id: str
    patient_id: str
    finding_id: str
    kind: RequirementKind
    about_fact_id: str
    field: str
    state: RequirementState


class Finding(Model):
    id: str
    patient_id: str
    pattern_id: str
    pattern_version: int
    eval_version: int
    status: FindingStatus
    revision_n: int
    index_episode_id: str
    marker_episode_id: str
    effect: str
    observation_ids: list[str]
    cited_source_ids: list[str]
    requirement_ids: list[str]
    headline: str


# ---------- investigation + memory ----------


class Question(Model):
    id: str
    patient_id: str
    requirement_id: str
    ask_role: AskRole
    text: str
    asked_at: Day | None
    answer: str | None
    answer_state: AnswerState | None


class FindingRevision(Model):
    id: str
    patient_id: str
    finding_id: str
    n: int
    status: FindingStatus
    reason: str
    changed_fact_ids: list[str]
    created_at: Day
    previous_n: int | None
    eval_version: int


class ReviewDecision(Model):
    id: str
    patient_id: str
    finding_id: str
    revision_n: int
    by_role: ReviewerRole
    decision: ReviewChoice
    reason: str
    decided_at: Day


class AgentStep(Model):
    id: str
    patient_id: str
    finding_id: str | None
    tool: AgentTool
    ok: bool
    args: dict[str, Any]
    result_ids: list[str]
    at: Day


# ---------- requests ----------


class EvidenceChange(Model):
    fact_id: str
    field: EditableField
    value: int | str | None = None
    state: AnswerState
    source_id: str | None = None


class EvidenceRequest(Model):
    event_id: str
    case_version: int
    change: EvidenceChange


class ReviewRequest(Model):
    case_version: int
    revision_n: int
    by_role: ReviewerRole
    decision: ReviewChoice
    reason: str = Field(min_length=1)


# ---------- responses ----------


class FactRef(Model):
    fact_id: str
    field: str
    label: str
    value: int | str | None
    state: AnswerState
    happened_at: Day | None
    source_ids: list[str]
    requirement_id: str | None = None


class QueryTraceEntry(Model):
    query: str  # file name in engine/queries without extension
    params: dict[str, Any]
    rows: int
    mode: Literal["fixture", "live"]


class TimelineResponse(Model):
    patient: Patient
    sources: list[Source]
    episodes: list[MedicationEpisode]
    observations: list[Observation]
    pending_evidence: list[EvidenceRequest]


class FindingsResponse(Model):
    patient_id: str
    case_version: int
    findings: list[Finding]


class InvestigationResponse(Model):
    patient_id: str
    case_version: int
    finding: Finding
    pattern: Pattern
    documented: list[FactRef]
    conflicts: list[FactRef]
    unknowns: list[FactRef]
    next_question: Question | None
    sources: list[Source]
    revisions: list[FindingRevision]
    decisions: list[ReviewDecision]
    query_trace: list[QueryTraceEntry]


class EvidenceResult(Model):
    event_id: str
    patient_id: str
    case_version_before: int
    case_version: int
    before: dict[str, Any]
    after: dict[str, Any]
    affected_finding_ids: list[str]
    new_revisions: list[FindingRevision]
    pending_reevaluation_ids: list[str]
    replayed: bool


class ReviewResult(Model):
    case_version: int
    decision: ReviewDecision
    finding: Finding


class ConflictError(Model):
    error: Literal["stale_case_version", "stale_revision"]
    patient_id: str
    sent: int
    current: int


class PacketItem(Model):
    finding: Finding
    pattern: Pattern
    documented: list[FactRef]
    conflicts: list[FactRef]
    unknowns: list[FactRef]
    open_questions: list[Question]
    revisions: list[FindingRevision]
    decisions: list[ReviewDecision]


class PacketResponse(Model):
    patient: Patient
    case_version: int
    disclaimer: str
    items: list[PacketItem]


class HealthResponse(Model):
    status: Literal["ok"]
    mode: Literal["fixtures", "graph"]
    falkordb: Literal["not_used", "up", "down"]


class ResetResponse(Model):
    reset: Literal[True]
    patients: list[Patient]


# ---------- fixture file ----------


class StoryFixture(Model):
    synthetic: Literal[True]
    story_id: str
    title: str
    notes: list[str]
    patient: Patient
    sources: list[Source]
    episodes: list[MedicationEpisode]
    observations: list[Observation]
    findings: list[Finding]
    requirements: list[EvidenceRequirement]
    questions: list[Question]
    revisions: list[FindingRevision]
    decisions: list[ReviewDecision]
    agent_steps: list[AgentStep]
    pending_evidence: list[EvidenceRequest]

    @model_validator(mode="after")
    def _patient_scoped(self) -> StoryFixture:
        pid = self.patient.id
        prefix = f"{pid}:"
        groups = [
            self.sources, self.episodes, self.observations, self.findings, self.requirements,
            self.questions, self.revisions, self.decisions, self.agent_steps,
        ]
        for group in groups:
            for item in group:
                if not item.id.startswith(prefix):
                    raise ValueError(f"{item.id} is not scoped to {pid}")
                if item.patient_id != pid:
                    raise ValueError(f"{item.id} has patient_id {item.patient_id}, expected {pid}")
        for req in self.pending_evidence:
            if not req.event_id.startswith(prefix):
                raise ValueError(f"event {req.event_id} is not scoped to {pid}")
        return self
