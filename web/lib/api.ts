// The ONE data adapter for the web app.
//   NEXT_PUBLIC_DATA_SOURCE=fixtures (default) -> reads lib/fixtures/fixtures.json, a copy of
//     data/snapshots/fixtures.json, which holds the stub API's real responses.
//   NEXT_PUBLIC_DATA_SOURCE=live -> calls NEXT_PUBLIC_API_URL.
// Components import `api` from here and never call fetch themselves.

import snapshotJson from "./fixtures/fixtures.json";
import type {
  AgentStep,
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
  ReviewDecision,
  ReviewRequest,
  ReviewResult,
  SnapshotFile,
  TimelineResponse,
} from "./types";

export type DataSource = "fixtures" | "live";

export const DATA_SOURCE: DataSource =
  process.env.NEXT_PUBLIC_DATA_SOURCE === "live" ? "live" : "fixtures";
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
// Server components run inside the web container, where localhost is not the API.
// API_INTERNAL_URL (runtime, e.g. http://api:8000 in docker compose) is used there instead.
const API_URL =
  typeof window === "undefined" ? (process.env.API_INTERNAL_URL ?? PUBLIC_API_URL) : PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

/** The write was based on an old case_version or revision. Reload, then retry. */
export class StaleError extends ApiError {
  constructor(public conflict: ConflictError) {
    super(409, conflict);
  }
}

export interface FirstDominoApi {
  health(): Promise<HealthResponse>;
  patients(): Promise<Patient[]>;
  timeline(pid: string): Promise<TimelineResponse>;
  findings(pid: string): Promise<FindingsResponse>;
  investigation(fid: string): Promise<InvestigationResponse>;
  submitEvidence(pid: string, body: EvidenceRequest): Promise<EvidenceResult>;
  review(fid: string, body: ReviewRequest): Promise<ReviewResult>;
  askQuestion(body: QuestionRequest): Promise<QuestionResult>;
  recordAgentStep(body: AgentStepRequest): Promise<AgentStepResult>;
  agentSteps(pid: string): Promise<AgentStepsResponse>;
  packet(pid: string): Promise<PacketResponse>;
  reset(): Promise<ResetResponse>;
}

// ---------- live ----------

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (res.status === 409) throw new StaleError(body as ConflictError);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const enc = encodeURIComponent;

const liveApi: FirstDominoApi = {
  health: () => call("/health"),
  patients: () => call("/patients"),
  timeline: (pid) => call(`/patients/${enc(pid)}/timeline`),
  findings: (pid) => call(`/patients/${enc(pid)}/findings`),
  investigation: (fid) => call(`/findings/${enc(fid)}/investigation`),
  submitEvidence: (pid, body) => call(`/patients/${enc(pid)}/evidence`, post(body)),
  review: (fid, body) => call(`/findings/${enc(fid)}/review`, post(body)),
  askQuestion: (body) => call("/questions", post(body)),
  recordAgentStep: (body) => call("/agent-steps", post(body)),
  agentSteps: (pid) => call(`/patients/${enc(pid)}/agent-steps`),
  packet: (pid) => call(`/patients/${enc(pid)}/packet`),
  reset: () => call("/sandbox/reset", post({})),
};

// ---------- fixtures ----------
// An in-memory session over the snapshot. It follows the API's write rules: a stale
// case_version or revision throws StaleError, a repeated event_id replays its result.
// Evidence events must be one of the precomputed pending_evidence events.

const snapshot = snapshotJson as unknown as SnapshotFile;
type CaseView = Pick<
  SnapshotFile["cases"][string],
  "timeline" | "findings" | "investigations" | "packet" | "agent_steps"
>;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let session: Record<string, CaseView> = {};
let applied: Record<string, EvidenceResult> = {};

function resetSession() {
  session = Object.fromEntries(
    Object.entries(snapshot.cases).map(([pid, c]) => [
      pid,
      clone({
        timeline: c.timeline,
        findings: c.findings,
        investigations: c.investigations,
        packet: c.packet,
        agent_steps: c.agent_steps,
      }),
    ]),
  );
  applied = {};
}
resetSession();

function caseOf(pid: string): CaseView {
  const c = session[pid];
  if (!c) throw new ApiError(404, { error: "not_found", detail: `patient ${pid}` });
  return c;
}

const patientOf = (scopedId: string) => scopedId.split(":", 1)[0];

function setVersion(c: CaseView, v: number) {
  c.timeline.patient.case_version = v;
  c.findings.case_version = v;
  c.packet.case_version = v;
  c.packet.patient.case_version = v;
  c.agent_steps.case_version = v;
  for (const inv of Object.values(c.investigations)) inv.case_version = v;
}

function stale(pid: string, sent: number, current: number): never {
  throw new StaleError({ error: "stale_case_version", patient_id: pid, sent, current });
}

const fixtureApi: FirstDominoApi = {
  health: async () => snapshot.health,
  patients: async () => Object.values(session).map((c) => clone(c.timeline.patient)),
  timeline: async (pid) => clone(caseOf(pid).timeline),
  findings: async (pid) => clone(caseOf(pid).findings),
  investigation: async (fid) => {
    const inv = caseOf(patientOf(fid)).investigations[fid];
    if (!inv) throw new ApiError(404, { error: "not_found", detail: `finding ${fid}` });
    return clone(inv);
  },
  submitEvidence: async (pid, body) => {
    const c = caseOf(pid);
    if (applied[body.event_id]) return { ...clone(applied[body.event_id]), replayed: true };
    const current = c.timeline.patient.case_version;
    if (body.case_version !== current)
      throw new StaleError({ error: "stale_case_version", patient_id: pid, sent: body.case_version, current });
    const known = snapshot.cases[pid]?.evidence[body.event_id];
    if (!known)
      throw new ApiError(501, {
        error: "fixture_mode",
        detail: "Only the story's pending evidence is available offline. Use the live API for other changes.",
      });
    session[pid] = clone({
      timeline: known.timeline_after,
      findings: known.findings_after,
      investigations: known.investigations_after,
      packet: known.packet_after,
      agent_steps: c.agent_steps,
    });
    applied[body.event_id] = clone(known.result);
    return clone(known.result);
  },
  review: async (fid, body) => {
    const pid = patientOf(fid);
    const c = caseOf(pid);
    const inv = c.investigations[fid];
    if (!inv) throw new ApiError(404, { error: "not_found", detail: `finding ${fid}` });
    const current = c.timeline.patient.case_version;
    if (body.case_version !== current)
      throw new StaleError({ error: "stale_case_version", patient_id: pid, sent: body.case_version, current });
    const finding = inv.finding;
    if (body.revision_n !== finding.revision_n)
      throw new StaleError({ error: "stale_revision", patient_id: pid, sent: body.revision_n, current: finding.revision_n });
    const k = 1 + inv.decisions.filter((d) => d.revision_n === finding.revision_n).length;
    const decision: ReviewDecision = {
      id: `${fid}:rev-${finding.revision_n}:dec-${k}`,
      patient_id: pid,
      finding_id: fid,
      revision_n: finding.revision_n,
      by_role: body.by_role,
      decision: body.decision,
      reason: body.reason,
      decided_at: c.timeline.patient.as_of_day,
    };
    const reviewed = { ...finding, status: "reviewed" as const };
    inv.finding = reviewed;
    inv.decisions = [...inv.decisions, decision];
    c.findings.findings = c.findings.findings.map((f) => (f.id === fid ? reviewed : f));
    for (const item of c.packet.items) {
      if (item.finding.id === fid) {
        item.finding = reviewed;
        item.decisions = [...item.decisions, decision];
      }
    }
    setVersion(c, current + 1);
    return { case_version: current + 1, decision: clone(decision), finding: clone(reviewed) };
  },
  askQuestion: async (body) => {
    const pid = patientOf(body.requirement_id);
    const c = caseOf(pid);
    const views = [
      ...Object.values(c.investigations).map((inv) => (inv.next_question ? [inv.next_question] : [])),
      ...c.packet.items.map((item) => item.open_questions),
    ].flat();
    const found = views.find((q) => q.requirement_id === body.requirement_id);
    if (!found) throw new ApiError(404, { error: "not_found", detail: `requirement ${body.requirement_id}` });
    const current = c.timeline.patient.case_version;
    if (found.asked_at !== null) return { case_version: current, question: clone(found), replayed: true };
    if (body.case_version !== current) stale(pid, body.case_version, current);
    for (const q of views.filter((q) => q.requirement_id === body.requirement_id)) {
      q.asked_at = c.timeline.patient.as_of_day;
      if (body.text) q.text = body.text;
    }
    setVersion(c, current + 1);
    return { case_version: current + 1, question: clone(found), replayed: false };
  },
  recordAgentStep: async (body) => {
    const pid = patientOf(body.step_id);
    const c = caseOf(pid);
    const current = c.timeline.patient.case_version;
    const existing = c.agent_steps.steps.find((s) => s.id === body.step_id);
    if (existing) return { case_version: current, step: clone(existing), replayed: true };
    if (body.case_version !== current) stale(pid, body.case_version, current);
    const step: AgentStep = {
      id: body.step_id,
      patient_id: pid,
      finding_id: body.finding_id ?? null,
      tool: body.tool,
      ok: body.ok,
      args: body.args,
      result_ids: body.result_ids,
      at: c.timeline.patient.as_of_day,
    };
    c.agent_steps.steps = [...c.agent_steps.steps, step]; // an audit record: case_version does not move
    return { case_version: current, step: clone(step), replayed: false };
  },
  agentSteps: async (pid) => clone(caseOf(pid).agent_steps),
  packet: async (pid) => clone(caseOf(pid).packet),
  reset: async () => {
    resetSession();
    return { reset: true, patients: Object.values(session).map((c) => clone(c.timeline.patient)) };
  },
};

export const api: FirstDominoApi = DATA_SOURCE === "live" ? liveApi : fixtureApi;
