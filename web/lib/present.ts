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

// Status names in plain words for a first-time visitor; the API's status codes stay behind
// "Show technical details".
export const STATUS: Record<FindingStatus, { label: string; tone: Tone; blurb: string }> = {
  candidate: {
    label: "Possible pattern",
    tone: "amber",
    blurb: "The order of events fits a published pattern. Worth a clinician's review.",
  },
  needs_evidence: {
    label: "Needs one more fact",
    tone: "amber",
    blurb: "The timing fits, but one fact the review depends on is not known yet.",
  },
  competing_explanation: {
    label: "Another explanation found",
    tone: "amber",
    blurb: "The record gives another reason for the second medicine. Both are shown side by side for the clinician.",
  },
  needs_reassessment: {
    label: "Needs a fresh look",
    tone: "amber",
    blurb: "The evidence changed after a clinician reviewed it. Their earlier decision is kept on the revision they saw.",
  },
  reviewed: {
    label: "Reviewed by a clinician",
    tone: "teal",
    blurb: "A clinician or pharmacist has recorded a decision on this version of the finding.",
  },
  not_matched: {
    label: "Doesn't fit the pattern",
    tone: "muted",
    blurb: "The recorded order of events does not fit the pattern.",
  },
};

/** Human titles for the three synthetic stories. */
export const STORY_TITLES: Record<string, string> = {
  "syn-p1": "The missing reason",
  "syn-p2": "Another explanation",
  "syn-p3": "When the record changes",
};

/** The three curated stories, not the patients visitors build in the lab (`lab-…`). */
export const isStory = (pid: string) => pid in STORY_TITLES;
export const isLabPatient = (pid: string) => pid.startsWith("lab-");

export const STATE_LABEL: Record<AnswerState, string> = {
  documented: "On record",
  reported: "Reported by the caregiver",
  conflicting: "Records disagree",
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
  unknown: "not known yet",
  conflicting: "records disagree",
  other_reason: "another reason on record",
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

// ---------- plain sentences for technical records ----------

/** Fact fields as a person would name them. Raw field names show under "Show technical details". */
export const FIELD_LABEL: Record<string, string> = {
  happened_at: "Date",
  indication: "Reason started",
  indication_state: "How the reason is known",
  state: "How the date is known",
  stop_day: "Stop date",
  dose_text: "Dose",
  recorded_at: "Recorded on day",
  source_ids: "Sources",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One sentence for a named graph query in the "How the graph found this" trace. */
export function querySentence(query: string, ids: string[]): string {
  switch (query) {
    case "q4_evidence_pack":
      return `Gathered the facts this finding links (${plural(ids.length, "fact")}), with their records.`;
    case "q2_next_question":
      return ids.length
        ? "Found the missing fact that the most open findings are waiting on."
        : "Looked for a missing fact still waiting to be asked: none.";
    case "q5_history":
      return `Read this finding's history (${plural(ids.length, "version")}).`;
    case "q9_requirements":
      return "Looked up the question that was already asked and is still unanswered.";
    case "q3_affected":
      return `Checked which findings depend on this fact (${ids.length}).`;
    default:
      return `Ran a named graph query (${plural(ids.length, "result")}).`;
  }
}

/** "Reason furosemide was started" -> "why furosemide was started", for agent step sentences. */
export function askedAbout(label: string): string {
  const reason = /^Reason (.+) was started$/i.exec(label);
  if (reason) return `why ${reason[1]} was started`;
  const start = /^(.+) started$/i.exec(label);
  if (start) return `when ${start[1]} was started`;
  const began = /^(.+) began$/i.exec(label);
  if (began) return `when the ${began[1].toLowerCase()} began`;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Said wherever no finding is shown: an empty walk is not an all-clear. */
export const NO_CHAIN_NOTE =
  "FirstDomino models one curated pattern, so no chain here does not rule anything else out. A clinician still reviews the whole medicine list.";
