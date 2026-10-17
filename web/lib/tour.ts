// The guided tour: ten steps over story 1 (the missing reason) and story 3 (when the record changes).
// Each step names the element it talks about (`target`, a data-tour value), the thing to click
// (`hotspot`), and the event that completes it. The step lives in the URL (?tour=story1&step=3) so a link
// opens a specific step. Wording follows the copy rules: possible pattern, on record, not known yet.

import { STATUS } from "./present";
import type { EvidenceResult, FindingStatus } from "./types";

export const TOUR_ID = "story1";

export type TourEvent = "finding-selected" | "evidence-recorded" | "agent-done" | "trace-opened";
export type DrawerTab = "investigation" | "history" | "agent";

/** The last payload of each event, so a step can describe what just happened. */
export interface TourMemory {
  change?: EvidenceResult;
  agent?: { steps: number; asked: boolean; failed: number };
}

type Text = string | ((m: TourMemory) => string);

export interface SandboxPreset {
  kind: "onset" | "start" | "indication";
  factId: string;
  day: number;
}

export interface TourStep {
  story: "syn-p1" | "syn-p3";
  title: string;
  body: Text;
  /** What to do, in one line. */
  todo: string;
  why: string;
  target: string;
  hotspot?: string;
  /** The event that completes the step. Without `stay`, the tour moves on by itself. */
  advanceOn?: TourEvent;
  stay?: boolean;
  /** Shown once the step's action is done (with `stay`). */
  done?: { body: Text; target?: string; hotspot?: string; tab?: DrawerTab };
  /** What the workspace sets up for the step. */
  select?: boolean;
  tab?: DrawerTab;
  /** Story moments revealed one by one (step 2). */
  beats?: { id: string; text: string }[];
  suggestions?: string[];
  sandbox?: SandboxPreset;
  /** Arcs stay quiet until the step that introduces them. */
  quietArcs?: boolean;
  finish?: boolean;
}

const FINDING_P1 = "syn-p1:fnd-ccb-edema-loop-1";
export const TOUR_FINDINGS: Record<TourStep["story"], string> = {
  "syn-p1": FINDING_P1,
  "syn-p3": "syn-p3:fnd-ccb-edema-loop-1",
};

/** The new status of the finding an answer touched, in plain words. */
function explainChange(m: TourMemory): string {
  const c = m.change?.finding_changes[0];
  if (!c) return "You arrived here directly, so there is no answer to show yet. Go back one step and pick an answer.";
  if (m.change?.pending_reevaluation_ids.includes(c.finding_id))
    return "The answer is recorded against this finding only; nothing else was touched. The finding is waiting for the rules to re-check it.";
  const from = STATUS[c.before.status].label;
  const to = STATUS[c.after.status].label;
  const why: Partial<Record<FindingStatus, string>> = {
    competing_explanation:
      "The answer gives furosemide a reason of its own, so the clinician sees two explanations side by side, not a verdict.",
    candidate:
      "The answer matches the side effect, so the chain is now a possible pattern worth a clinician's review.",
    needs_evidence: "A fact the review depends on is still not known.",
  };
  return `Only this finding was re-checked; nothing else was touched. It moved from “${from}” to “${to}”. ${
    why[c.after.status] ?? STATUS[c.after.status].blurb
  }`;
}

export const TOUR_STEPS: TourStep[] = [
  {
    story: "syn-p1",
    title: "The timeline",
    body:
      "This is one synthetic patient's medicines over time. Each line is a medicine, starting on the day it was started. The diamonds on the Symptoms line are symptoms.",
    todo: "Look it over, then press Next.",
    why: "Cascades hide across visits and prescribers. Lining every medicine and symptom up on one timeline makes the order of events visible.",
    target: "river",
    quietArcs: true,
  },
  {
    story: "syn-p1",
    title: "Story 1, in order",
    body: "Watch the story play out in order.",
    todo: "Watch, then press Next.",
    why: "The order is the whole argument: a medicine, then a symptom, then a second medicine for that symptom.",
    target: "river",
    quietArcs: true,
    beats: [
      { id: "syn-p1:ep-amlodipine", text: "Day 0 · amlodipine is started, for blood pressure." },
      { id: "syn-p1:obs-ankle-swelling", text: "Day 21 · ankle swelling, reported by the caregiver." },
      { id: "syn-p1:ep-furosemide", text: "Day 35 · furosemide is started. The reason was not recorded." },
    ],
  },
  {
    story: "syn-p1",
    title: "A possible pattern",
    body:
      "This amber arc is a possible pattern from published research: amlodipine can make ankles swell, and swelling is sometimes treated with a water tablet like furosemide.",
    todo: "Click the amber arc.",
    why: "Patterns come from a short, curated, cited list. An arc is a reason to look, never a conclusion.",
    target: "arc",
    hotspot: "arc-hotspot",
    advanceOn: "finding-selected",
  },
  {
    story: "syn-p1",
    title: "The investigation",
    body:
      "Here is what is on record, what is not known yet, and the one missing fact: nobody wrote down why furosemide was started.",
    todo: "Read it over, then press Next.",
    why: "Keeping “on record” apart from “not known yet” stops a guess from passing as a fact.",
    target: "drawer",
    hotspot: "unknowns",
    select: true,
    tab: "investigation",
  },
  {
    story: "syn-p1",
    title: "Answer the missing fact",
    body:
      "Why was furosemide started? Imagine you are the caregiver. “Ankle swelling” fits the pattern; “heart failure” would be another explanation.",
    todo: "Pick an answer, then press Record answer.",
    why: "One answer can settle whether this chain deserves a clinician's time. “Not available” is also an answer, and it is never read as “no”.",
    target: "next-question",
    hotspot: "suggestions",
    advanceOn: "evidence-recorded",
    select: true,
    tab: "investigation",
    suggestions: ["heart failure", "ankle swelling"],
  },
  {
    story: "syn-p1",
    title: "Only this finding changed",
    body: explainChange,
    todo: "Press Next.",
    why: "The graph knows which findings depend on which facts, so an answer re-checks only those. Each re-check is kept as a new version.",
    target: "change-card",
    select: true,
    tab: "investigation",
  },
  {
    story: "syn-p1",
    title: "Ask the review assistant",
    body:
      "The review assistant reads the evidence, finds what is missing and drafts the next conversation with the clinician. It can read and ask. It never decides and never changes a fact.",
    todo: "Press Run review agent.",
    why: "AI helps with the legwork, but only fixed rules create findings, and only a person can answer a question or record a decision.",
    target: "agent",
    hotspot: "agent-run",
    advanceOn: "agent-done",
    stay: true,
    select: true,
    tab: "agent",
    done: {
      target: "agent",
      body: (m) =>
        `Done: ${m.agent?.steps ?? "a few"} steps, each one recorded. ${
          m.agent?.asked ? "It recorded a question for a person to answer." : "Nothing was waiting to be asked, so it asked nothing."
        } It read and drafted; it changed no fact and made no decision.`,
    },
  },
  {
    story: "syn-p1",
    title: "How the graph found this",
    body:
      "Every view is built by a few named graph queries, each starting from the patient.",
    todo: "Open “How the graph found this”.",
    why: "Judges and clinicians can check the work: each query, what it returned, and the exact query text behind it.",
    target: "query-trace",
    hotspot: "query-trace-toggle",
    advanceOn: "trace-opened",
    stay: true,
    select: true,
    tab: "investigation",
    done: {
      target: "query-trace",
      body:
        "FalkorDB holds the medicines, symptoms, records and findings as one connected graph, so a chain is a single walk from the patient, and a changed fact points straight at the findings that depend on it.",
    },
  },
  {
    story: "syn-p3",
    title: "When the record changes",
    body:
      "Story 3. A clinician already reviewed this finding. Then a GP note arrived late: the swelling started on day 14, not day 28.",
    todo: "Press Confirm correction.",
    why: "Records arrive late. A review is only as good as the evidence it saw, so the tool must notice when that evidence changes.",
    target: "pending",
    hotspot: "pending-confirm",
    advanceOn: "evidence-recorded",
    stay: true,
    select: true,
    tab: "investigation",
    done: {
      target: "kept-decision",
      tab: "history",
      body:
        "The finding now says “Needs a fresh look”. The clinician's decision is kept, attached to version 1, the one they actually saw.",
    },
  },
  {
    story: "syn-p3",
    title: "An unrelated medicine",
    body:
      "Atorvastatin (for cholesterol) is not part of this pattern. Change its start date in the sandbox and see what happens.",
    todo: "Press Apply this change.",
    why: "A useful alert is quiet when nothing relevant changed. Re-checking only what depends on a fact keeps the noise down.",
    target: "sandbox",
    hotspot: "sandbox-apply",
    advanceOn: "evidence-recorded",
    stay: true,
    select: true,
    tab: "investigation",
    sandbox: { kind: "start", factId: "syn-p3:ep-atorvastatin", day: 7 },
    finish: true,
    done: {
      target: "change-card",
      body: (m) =>
        m.change && m.change.finding_changes.length === 0
          ? "Nothing depends on atorvastatin, so nothing changed: no finding was re-checked and no new version was made. That is the tour. Open the packet a clinician would read, or start again."
          : "That edit touched a finding the pattern depends on. That is the tour. Open the packet a clinician would read, or start again.",
    },
  },
];

export const TOUR_LENGTH = TOUR_STEPS.length;

export const textOf = (t: Text, m: TourMemory) => (typeof t === "function" ? t(m) : t);

export const tourHref = (step: number) => `/patients/${TOUR_STEPS[step - 1].story}?tour=${TOUR_ID}&step=${step}`;

// Which stories this tour run has already reset, so a reload mid-tour keeps the visitor's answers.
const RESET_KEY = "fd.tour.reset";

export function resetStories(): string[] {
  try {
    const raw = sessionStorage.getItem(RESET_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function markReset(pid: string) {
  try {
    sessionStorage.setItem(RESET_KEY, JSON.stringify([...new Set([...resetStories(), pid])]));
  } catch {
    // storage blocked: the story is reset again on the next visit to it
  }
}

/** Start a fresh run: every story the tour uses is reset again when the tour reaches it. */
export function clearTourRun() {
  try {
    sessionStorage.removeItem(RESET_KEY);
  } catch {
    // nothing to clear
  }
}
