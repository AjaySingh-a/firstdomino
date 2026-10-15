// Presentation rules shared by the workspace. Wording here is user-facing: keep it to
// "possible pattern", "documented", "reported", "not known yet". Never imply a cause.

import type {
  AnswerState,
  Finding,
  FindingStatus,
  MedicationEpisode,
  Observation,
  ReviewChoice,
  Source,
  SourceKind,
  TimelineResponse,
} from "./types";

export type Tone = "amber" | "teal" | "muted";

export const STATUS: Record<FindingStatus, { label: string; tone: Tone; blurb: string }> = {
  candidate: {
    label: "Possible pattern",
    tone: "amber",
    blurb: "The timing fits a known pattern. Worth a clinician's review.",
  },
  needs_evidence: {
    label: "Needs evidence",
    tone: "amber",
    blurb: "The timing fits, but a fact the review depends on is not known yet.",
  },
  competing_explanation: {
    label: "Competing explanation",
    tone: "amber",
    blurb: "Another reason is documented. Both are shown side by side for the clinician.",
  },
  needs_reassessment: {
    label: "Needs reassessment",
    tone: "amber",
    blurb: "Evidence changed after a review. The earlier decision is kept on its revision.",
  },
  reviewed: {
    label: "Reviewed",
    tone: "teal",
    blurb: "A clinician or pharmacist has recorded a decision on this revision.",
  },
  not_matched: {
    label: "Not matched",
    tone: "muted",
    blurb: "The documented order of events does not fit the pattern.",
  },
};

export const STATE_LABEL: Record<AnswerState, string> = {
  documented: "Documented",
  reported: "Reported by caregiver",
  conflicting: "Conflicting",
  unknown: "Not known yet",
  not_available: "Not available",
};

export const SOURCE_KIND: Record<SourceKind, { label: string; short: string }> = {
  clinic_letter: { label: "Clinic letter", short: "Clinic" },
  discharge_summary: { label: "Discharge summary", short: "Discharge" },
  pharmacy_record: { label: "Pharmacy record", short: "Pharmacy" },
  gp_note: { label: "GP note", short: "GP note" },
  caregiver_report: { label: "Caregiver report", short: "Caregiver" },
};

export const DECISION_LABEL: Record<ReviewChoice, string> = {
  follow_up: "Follow up",
  no_action: "No action",
  defer: "Defer",
};

export const day = (d: number | null | undefined) => (d === null || d === undefined ? "date not known" : `day ${d}`);
export const shortDay = (d: number | null | undefined) => (d === null || d === undefined ? "d?" : `d${d}`);

export const stripSynthetic = (s: string) => s.replace(/\s*\(synthetic\)\s*$/i, "");

/** "Possible pattern: amlodipine, then ..." -> "Amlodipine, then ..." for compact lists. */
export const shortHeadline = (s: string) => {
  const t = s.replace(/^Possible pattern:\s*/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** True for findings that are still a possible pattern (not "not_matched"). */
export const isOpenPattern = (f: Finding) => f.status !== "not_matched";

// ---------- links drawn as arcs in the Medication River ----------

export type LinkState = "documented" | "unknown" | "conflicting" | "other_reason";

export interface FindingLink {
  key: string;
  fromId: string;
  toId: string;
  fromDay: number | null;
  toDay: number | null;
  state: LinkState;
}

const worst = (states: AnswerState[]): LinkState =>
  states.includes("conflicting")
    ? "conflicting"
    : states.some((s) => s === "unknown" || s === "not_available")
      ? "unknown"
      : "documented";

/**
 * A finding is drawn as two links: first medicine -> symptom, symptom -> second medicine.
 * The second link also depends on why the second medicine was started.
 */
export function findingLinks(f: Finding, t: TimelineResponse): FindingLink[] {
  const ep = new Map(t.episodes.map((e) => [e.id, e]));
  const obs = new Map(t.observations.map((o) => [o.id, o]));
  const a = ep.get(f.index_episode_id);
  const b = ep.get(f.marker_episode_id);
  const o = f.observation_ids.map((id) => obs.get(id)).find(Boolean);
  if (!a || !b || !o) return [];

  const dateState = (x: MedicationEpisode | Observation): AnswerState =>
    x.happened_at === null ? "unknown" : x.state;

  const first = worst([dateState(a), dateState(o)]);
  let second = worst([dateState(o), dateState(b), b.indication_state]);
  if (second === "documented" && f.status === "competing_explanation") second = "other_reason";

  return [
    { key: `${f.id}:1`, fromId: a.id, toId: o.id, fromDay: a.happened_at, toDay: o.happened_at, state: first },
    { key: `${f.id}:2`, fromId: o.id, toId: b.id, fromDay: o.happened_at, toDay: b.happened_at, state: second },
  ];
}

export const LINK_LABEL: Record<LinkState, string | null> = {
  documented: null,
  unknown: "unknown",
  conflicting: "conflicting",
  other_reason: "other reason documented",
};

/** Everything a selected finding touches: its episodes, observations and sources. */
export function litIds(f: Finding, t: TimelineResponse): Set<string> {
  const ids = new Set<string>([f.index_episode_id, f.marker_episode_id, ...f.observation_ids, ...f.cited_source_ids]);
  for (const x of [...t.episodes, ...t.observations]) {
    if (ids.has(x.id)) x.source_ids.forEach((s) => ids.add(s));
  }
  return ids;
}

export function sourceById(t: TimelineResponse): Map<string, Source> {
  return new Map(t.sources.map((s) => [s.id, s]));
}
