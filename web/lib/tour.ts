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
    return "The answer is recorded against this finding only. It is waiting for the rules to re-check it.";
  const from = STATUS[c.before.status].label;
  const to = STATUS[c.after.status].label;
  const why: Partial<Record<FindingStatus, string>> = {
    competing_explanation: "Furosemide now has its own reason: two explanations side by side, not a verdict.",
    candidate: "The answer fits the side effect: a possible pattern worth a clinician's review.",
    needs_evidence: "A fact the review depends on is still not known.",
  };
  return `Only this finding was re-checked. It moved from “${from}” to “${to}”. ${
    why[c.after.status] ?? STATUS[c.after.status].blurb
  }`;
}

export const TOUR_STEPS: TourStep[] = [
  {
    story: "syn-p1",
    title: "The timeline",
    body: "One synthetic patient's medicines over time. Each line starts the day that medicine started. Diamonds on the Symptoms line are symptoms.",
    todo: "Look it over, then press Next.",
    why: "Cascades hide across visits and prescribers. One timeline makes the order of events visible.",
    target: "river",
    quietArcs: true,
  },
  {
    story: "syn-p1",
    title: "Story 1, in order",
    body: "Watch the story play out in order.",
    todo: "Watch, then press Next.",
    why: "The order is the whole argument: a medicine, a symptom, then a second medicine for it.",
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
    body: "The amber arc is a possible pattern from published research: amlodipine can swell ankles, and swelling is sometimes treated with furosemide.",
    todo: "Click the amber arc.",
    why: "Patterns come from a short, cited list. An arc is a reason to look, never a conclusion.",
    target: "arc",
    hotspot: "arc-hotspot",
    advanceOn: "finding-selected",
  },
  {
    story: "syn-p1",
    title: "The investigation",
    body: "What is on record, what is not known yet, and the one missing fact: nobody wrote down why furosemide was started.",
    todo: "Read it over, then press Next.",
    why: "Keeping “on record” apart from “not known yet” stops a guess passing as a fact.",
    target: "drawer",
    hotspot: "unknowns",
    select: true,
    tab: "investigation",
  },
  {
    story: "syn-p1",
    title: "Answer the missing fact",
    body: "Why was furosemide started? Answer as the caregiver. “Ankle swelling” fits the pattern; “heart failure” would be another explanation.",
    todo: "Pick an answer, then press Record answer.",
    why: "One answer can settle whether this chain needs a clinician's time. “Not available” never means “no”.",
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
    why: "The graph knows which findings depend on which facts, so only those are re-checked, each as a new version.",
    target: "change-card",
    select: true,
    tab: "investigation",
  },
  {
    story: "syn-p1",
    title: "Ask the review assistant",
    body: "The review assistant reads the evidence, finds what is missing and drafts the next conversation. It can read and ask; it never decides or changes a fact.",
    todo: "Press Run review agent.",
    why: "AI does the legwork. Only fixed rules create findings; only a person answers or decides.",
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
          m.agent?.asked ? "It recorded a question for a person." : "Nothing was waiting, so it asked nothing."
        } It changed no fact and made no decision.`,
    },
  },
  {
    story: "syn-p1",
    title: "How the graph found this",
    body: "Every view is built by a few named graph queries, each starting from the patient.",
    todo: "Open “How the graph found this”.",
    why: "Anyone can check the work: each query, what it returned, and its exact text.",
    target: "query-trace",
    hotspot: "query-trace-toggle",
    advanceOn: "trace-opened",
    stay: true,
    select: true,
    tab: "investigation",
    done: {
      target: "query-trace",
      body: "FalkorDB holds medicines, symptoms, records and findings as one graph: a chain is one walk, and a changed fact points at its findings.",
    },
  },
  {
    story: "syn-p3",
    title: "When the record changes",
    body: "Story 3. A clinician already reviewed this finding. Then a late GP note said the swelling started on day 14, not day 28.",
    todo: "Press Confirm correction.",
    why: "Records arrive late. A review is only as good as the evidence it saw.",
    target: "pending",
    hotspot: "pending-confirm",
    advanceOn: "evidence-recorded",
    stay: true,
    select: true,
    tab: "investigation",
    done: {
      target: "kept-decision",
      tab: "history",
      body: "The finding now says “Needs a fresh look”. The clinician's decision is kept on version 1, the one they saw.",
    },
  },
  {
    story: "syn-p3",
    title: "An unrelated medicine",
    body: "Atorvastatin (for cholesterol) is not part of this pattern. Change its start date in the sandbox and see what happens.",
    todo: "Press Apply this change.",
    why: "A useful alert stays quiet when nothing relevant changed.",
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
          ? "Nothing depends on atorvastatin, so nothing changed: no finding re-checked, no new version. That is the tour. Open the clinician's packet, or start again."
          : "That edit touched a finding the pattern depends on. That is the tour. Open the clinician's packet, or start again.",
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

// Whether this browser has been offered the tour: "started" or "skipped" once the visitor chooses, so the
// welcome card and the pulse do not come back. The story-page banner is shown at most once (BANNER_KEY).
const OFFER_KEY = "fd.tour.offer";
const BANNER_KEY = "fd.tour.banner";

export type TourChoice = "started" | "skipped";

export function tourChoice(): TourChoice | null {
  try {
    const v = localStorage.getItem(OFFER_KEY);
    return v === "started" || v === "skipped" ? v : null;
  } catch {
    return null;
  }
}

export function rememberTourChoice(choice: TourChoice) {
  try {
    localStorage.setItem(OFFER_KEY, choice);
  } catch {
    // storage blocked: the offer comes back next visit
  }
}

/** True the first time it is called in this browser, then false. */
export function takeBannerTurn(): boolean {
  try {
    if (localStorage.getItem(BANNER_KEY) === "1") return false;
    localStorage.setItem(BANNER_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** What every "start the tour" control does on click: a fresh run, and the choice remembered. */
export function startTour() {
  clearTourRun();
  rememberTourChoice("started");
}
