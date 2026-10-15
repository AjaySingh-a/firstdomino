// The ONE data adapter for the web app.
//   NEXT_PUBLIC_DATA_SOURCE=fixtures (default) -> reads lib/fixtures/fixtures.json, a copy of
//     data/snapshots/fixtures.json, which holds the stub API's real responses.
//   NEXT_PUBLIC_DATA_SOURCE=live -> calls NEXT_PUBLIC_API_URL.
// Components import `api` from here and never call fetch themselves.

import snapshotJson from "./fixtures/fixtures.json";
import type {
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
  SnapshotFile,
  TimelineResponse,
} from "./types";

export type DataSource = "fixtures" | "live";

export const DATA_SOURCE: DataSource =
  process.env.NEXT_PUBLIC_DATA_SOURCE === "live" ? "live" : "fixtures";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
  packet: (pid) => call(`/patients/${enc(pid)}/packet`),
  reset: () => call("/sandbox/reset", post({})),
};

// ---------- fixtures ----------
// Read-only snapshots, plus the precomputed result for each story's pending_evidence.
// Anything else that writes needs the live API.

const snapshot = snapshotJson as unknown as SnapshotFile;

function caseOf(pid: string) {
  const c = snapshot.cases[pid];
  if (!c) throw new ApiError(404, { error: "not_found", detail: `patient ${pid}` });
  return c;
}

const patientOf = (scopedId: string) => scopedId.split(":", 1)[0];

const fixtureApi: FirstDominoApi = {
  health: async () => snapshot.health,
  patients: async () => snapshot.patients,
  timeline: async (pid) => caseOf(pid).timeline,
  findings: async (pid) => caseOf(pid).findings,
  investigation: async (fid) => {
    const inv = caseOf(patientOf(fid)).investigations[fid];
    if (!inv) throw new ApiError(404, { error: "not_found", detail: `finding ${fid}` });
    return inv;
  },
  submitEvidence: async (pid, body) => {
    const c = caseOf(pid);
    const current = c.timeline.patient.case_version;
    const known = c.evidence[body.event_id];
    if (!known) {
      if (body.case_version !== current)
        throw new StaleError({ error: "stale_case_version", patient_id: pid, sent: body.case_version, current });
      throw new ApiError(501, { error: "fixture_mode", detail: "Only pending_evidence events are precomputed. Use the live API." });
    }
    if (body.case_version !== known.request.case_version)
      throw new StaleError({ error: "stale_case_version", patient_id: pid, sent: body.case_version, current });
    return known.result;
  },
  review: async () => {
    throw new ApiError(501, { error: "fixture_mode", detail: "Reviews need the live API." });
  },
  packet: async (pid) => caseOf(pid).packet,
  reset: async () => ({ reset: true, patients: snapshot.patients }),
};

export const api: FirstDominoApi = DATA_SOURCE === "live" ? liveApi : fixtureApi;
