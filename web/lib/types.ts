// Contract types. Hand-mirrored from api/models.py.
// tests/test_contracts.py fails if an interface or field name drifts.
//
// Story time is a day number. Every fact has happened_at (day or null), recorded_at and a state.
// Every ID is patient-scoped: "<patient_id>:<local id>". No status means "caused".

export type Day = number;

export type FactState = "documented" | "reported" | "conflicting" | "unknown";
/** An answer can also be not_available, which is never treated as "no". */
export type AnswerState = FactState | "not_available";
export type FindingStatus =
  | "candidate"
  | "needs_evidence"
  | "competing_explanation"
  | "needs_reassessment"
  | "reviewed"
  | "not_matched";
export type RequirementKind = "start_day" | "onset_day" | "indication" | "order";
export type RequirementState = "missing" | "provided" | "not_available";
export type SourceKind =
  | "clinic_letter"
  | "discharge_summary"
  | "pharmacy_record"
  | "gp_note"
  | "caregiver_report";
export type ReviewerRole = "clinician" | "pharmacist";
export type ReviewChoice = "follow_up" | "no_action" | "defer";
export type AskRole = "caregiver" | "prescriber" | "pharmacist";
export type AgentTool =
  | "get_investigation"
  | "get_next_question"
  | "draft_question_text"
  | "draft_packet_text";
export type EditableField = "happened_at" | "state" | "indication" | "indication_state" | "stop_day";

// ---------- knowledge ----------

export interface EvidenceRef {
  citation: string;
  doi: string | null;
  url: string | null;
  note: string | null;
}

export interface Pattern {
  id: string;
  version: number;
  title: string;
  index_class: string;
  via_effect: string;
  marker_class: string;
  window_days: number;
  requires: RequirementKind[];
  evidence_refs: EvidenceRef[];
}

export interface Ingredient {
  name: string;
  rxcui: string;
  drug_class: string;
}

// ---------- patient facts ----------

export interface Patient {
  id: string;
  label: string;
  age_band: string;
  case_version: number;
  as_of_day: Day;
  synthetic: true;
}

export interface Source {
  id: string;
  patient_id: string;
  kind: SourceKind;
  label: string;
  happened_at: Day | null;
  recorded_at: Day;
}

export interface Fact {
  id: string;
  patient_id: string;
  happened_at: Day | null;
  recorded_at: Day;
  state: FactState;
  source_ids: string[];
}

/** happened_at = start day; state = state of the start day. */
export interface MedicationEpisode extends Fact {
  ingredient: Ingredient;
  dose_text: string;
  indication: string | null;
  indication_state: AnswerState;
  stop_day: Day | null;
  prescriber_specialty: string | null;
}

/** happened_at = onset day; state = state of the onset day. */
export interface Observation extends Fact {
  label: string;
  effect: string;
}

// ---------- reasoning ----------

export interface EvidenceRequirement {
  id: string;
  patient_id: string;
  finding_id: string;
  kind: RequirementKind;
  about_fact_id: string;
  field: string;
  state: RequirementState;
}

export interface Finding {
  id: string;
  patient_id: string;
  pattern_id: string;
  pattern_version: number;
  eval_version: number;
  status: FindingStatus;
  revision_n: number;
  index_episode_id: string;
  marker_episode_id: string;
  effect: string;
  observation_ids: string[];
  cited_source_ids: string[];
  requirement_ids: string[];
  headline: string;
}

// ---------- investigation + memory ----------

export interface Question {
  id: string;
  patient_id: string;
  requirement_id: string;
  ask_role: AskRole;
  text: string;
  asked_at: Day | null;
  answer: string | null;
  answer_state: AnswerState | null;
}

export interface FindingRevision {
  id: string;
  patient_id: string;
  finding_id: string;
  n: number;
  status: FindingStatus;
  reason: string;
  changed_fact_ids: string[];
  created_at: Day;
  previous_n: number | null;
  eval_version: number;
}

export interface ReviewDecision {
  id: string;
  patient_id: string;
  finding_id: string;
  revision_n: number;
  by_role: ReviewerRole;
  decision: ReviewChoice;
  reason: string;
  decided_at: Day;
}

export interface AgentStep {
  id: string;
  patient_id: string;
  finding_id: string | null;
  tool: AgentTool;
  ok: boolean;
  args: Record<string, unknown>;
  result_ids: string[];
  at: Day;
}

// ---------- requests ----------

export interface EvidenceChange {
  fact_id: string;
  field: EditableField;
  value?: number | string | null;
  state: AnswerState;
  source_id?: string | null;
}

export interface EvidenceRequest {
  event_id: string;
  case_version: number;
  change: EvidenceChange;
}

export interface ReviewRequest {
  case_version: number;
  revision_n: number;
  by_role: ReviewerRole;
  decision: ReviewChoice;
  reason: string;
}

/** Record that the question for one open requirement was asked. No text = the deterministic template. */
export interface QuestionRequest {
  case_version: number;
  requirement_id: string;
  text?: string | null;
}

/** One review-agent step. step_id is patient-scoped and idempotent. */
export interface AgentStepRequest {
  step_id: string;
  case_version: number;
  finding_id?: string | null;
  tool: AgentTool;
  ok: boolean;
  args: Record<string, unknown>;
  result_ids: string[];
}

// ---------- responses ----------

export interface FactRef {
  fact_id: string;
  field: string;
  label: string;
  value: number | string | null;
  state: AnswerState;
  happened_at: Day | null;
  source_ids: string[];
  requirement_id: string | null;
}

export interface QueryTraceEntry {
  query: string;
  params: Record<string, unknown>;
  rows: number;
  mode: "fixture" | "live";
  result_ids: string[]; // IDs the query returned (facts, requirements, revisions)
}

export interface TimelineResponse {
  patient: Patient;
  sources: Source[];
  episodes: MedicationEpisode[];
  observations: Observation[];
  pending_evidence: EvidenceRequest[];
}

export interface FindingsResponse {
  patient_id: string;
  case_version: number;
  findings: Finding[];
}

export interface InvestigationResponse {
  patient_id: string;
  case_version: number;
  finding: Finding;
  pattern: Pattern;
  documented: FactRef[];
  conflicts: FactRef[];
  unknowns: FactRef[];
  next_question: Question | null;
  sources: Source[];
  revisions: FindingRevision[];
  decisions: ReviewDecision[];
  query_trace: QueryTraceEntry[];
}

/** One affected finding before and after an evidence change. */
export interface FindingChange {
  finding_id: string;
  before: Finding;
  after: Finding;
}

export interface EvidenceResult {
  event_id: string;
  patient_id: string;
  case_version_before: number;
  case_version: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  affected_finding_ids: string[];
  new_revisions: FindingRevision[];
  finding_changes: FindingChange[];
  pending_reevaluation_ids: string[];
  replayed: boolean;
}

export interface ReviewResult {
  case_version: number;
  decision: ReviewDecision;
  finding: Finding;
}

export interface QuestionResult {
  case_version: number;
  question: Question;
  replayed: boolean;
}

/** case_version does not move for an agent step: it is an audit record. */
export interface AgentStepResult {
  case_version: number;
  step: AgentStep;
  replayed: boolean;
}

export interface AgentStepsResponse {
  patient_id: string;
  case_version: number;
  steps: AgentStep[];
}

export interface ConflictError {
  error: "stale_case_version" | "stale_revision";
  patient_id: string;
  sent: number;
  current: number;
}

export interface PacketItem {
  finding: Finding;
  pattern: Pattern;
  documented: FactRef[];
  conflicts: FactRef[];
  unknowns: FactRef[];
  open_questions: Question[];
  revisions: FindingRevision[];
  decisions: ReviewDecision[];
}

export interface PacketResponse {
  patient: Patient;
  case_version: number;
  disclaimer: string;
  items: PacketItem[];
}

export interface HealthResponse {
  status: "ok";
  mode: "fixtures" | "graph";
  falkordb: "not_used" | "up" | "down";
}

export interface ResetResponse {
  reset: true;
  patients: Patient[];
}

// ---------- fixture file (data/stories/*.json) ----------

export interface StoryFixture {
  synthetic: true;
  story_id: string;
  title: string;
  notes: string[];
  patient: Patient;
  sources: Source[];
  episodes: MedicationEpisode[];
  observations: Observation[];
  findings: Finding[];
  requirements: EvidenceRequirement[];
  questions: Question[];
  revisions: FindingRevision[];
  decisions: ReviewDecision[];
  agent_steps: AgentStep[];
  pending_evidence: EvidenceRequest[];
}

// ---------- snapshot file (data/snapshots/fixtures.json), read by lib/api.ts ----------

export type SnapshotFile = {
  synthetic: true;
  health: HealthResponse;
  patients: Patient[];
  cases: Record<
    string,
    {
      timeline: TimelineResponse;
      findings: FindingsResponse;
      investigations: Record<string, InvestigationResponse>;
      packet: PacketResponse;
      agent_steps: AgentStepsResponse;
      evidence: Record<
        string,
        {
          request: EvidenceRequest;
          result: EvidenceResult;
          timeline_after: TimelineResponse;
          findings_after: FindingsResponse;
          investigations_after: Record<string, InvestigationResponse>;
          packet_after: PacketResponse;
        }
      >;
    }
  >;
};
