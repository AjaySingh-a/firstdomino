"use client";

// The next question for a finding, answerable in place. Three answers:
//   a value      a day (for a date) or text (for a reason)
//   not available  recorded as an answer, never read as "no"
//   skip for now   nothing is written; the question comes back on the next visit
// Submitting writes POST /patients/{id}/evidence with an event_id and the case_version it was
// prepared against. A retry of the same answer reuses its event_id, so the server replays it.

import { AnimatePresence, motion } from "framer-motion";
import { MessageCircleQuestion, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { DATA_SOURCE } from "@/lib/api";
import { STATE_LABEL, day } from "@/lib/present";
import { useTech } from "@/lib/tech";
import type { AnswerState, EvidenceRequest, InvestigationResponse, TimelineResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export type SubmitOutcome = "ok" | "stale" | "error";
export type SubmitEvidence = (req: EvidenceRequest) => Promise<SubmitOutcome>;

type Choice = "value" | "not_available" | "skip";

export const newEventId = (pid: string) =>
  `${pid}:evt-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;

/** Keeps one event_id per distinct answer, so resending the same answer is idempotent. */
export function useEventId(pid: string) {
  const ref = useRef<{ key: string; id: string } | null>(null);
  return (key: string) => {
    if (ref.current?.key !== key) ref.current = { key, id: newEventId(pid) };
    return ref.current.id;
  };
}

export const pill =
  "cursor-pointer rounded-full border border-rule-strong px-3 py-1 text-[12.5px] text-ink-2 transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-ivory peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ink";

export const field =
  "w-full rounded-[4px] border border-rule-strong bg-paper px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none";

export function DayInput({
  value,
  onChange,
  max,
  id,
}: {
  value: number | null;
  onChange: (d: number) => void;
  max: number;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={max}
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Day"
        className="h-1 flex-1 cursor-pointer accent-[var(--ink)]"
      />
      <label className="flex items-baseline gap-1 font-mono text-[12px] text-ink-3">
        day
        <input
          id={id}
          type="number"
          min={0}
          max={max}
          value={value ?? ""}
          onChange={(e) => e.target.value !== "" && onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value)))))}
          className="tabular w-16 rounded-[4px] border border-rule-strong bg-paper px-2 py-1 text-[13px] text-ink focus:border-ink focus:outline-none"
        />
      </label>
    </div>
  );
}

export function NextQuestion({
  inv,
  timeline,
  stale,
  suggestions,
  onSubmit,
  onReload,
}: {
  inv: InvestigationResponse;
  timeline: TimelineResponse;
  stale: boolean;
  /** Ready-made answers to tap (the guided tour offers two). */
  suggestions?: string[];
  onSubmit: SubmitEvidence;
  onReload: () => void;
}) {
  const tech = useTech();
  const q = inv.next_question;
  const [choice, setChoice] = useState<Choice>("value");
  const [text, setText] = useState("");
  const [dayValue, setDayValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<string | null>(null);
  const eventId = useEventId(inv.patient_id);

  if (!q) return <p className="text-[13px] italic text-ink-3">No open question for this finding.</p>;

  // What the question asks for: the open requirement's fact and field.
  const target = inv.unknowns.find((u) => u.requirement_id === q.requirement_id);
  const isDay = target?.field === "happened_at" || target?.field === "stop_day";
  const asOf = timeline.patient.as_of_day;
  // The caregiver reports; a prescriber or pharmacist answer is documented.
  const state: AnswerState = q.ask_role === "caregiver" ? "reported" : "documented";
  const value = isDay ? dayValue : text.trim() || null;
  const live = DATA_SOURCE === "live";
  const ready = choice === "skip" || (!!target && (choice === "not_available" || value !== null));

  if (skipped === q.id) {
    return (
      <div className="rounded-[6px] border border-dashed border-rule-strong p-3.5">
        <p className="text-[13px] text-ink-2">Skipped for now. Nothing was recorded, and the question stays open.</p>
        <button onClick={() => setSkipped(null)} className="mt-1.5 text-[12px] text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink">
          Show the question again
        </button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q || !target) return;
    if (choice === "skip") {
      setSkipped(q.id);
      return;
    }
    const change =
      choice === "not_available"
        ? { fact_id: target.fact_id, field: target.field as EvidenceRequest["change"]["field"], value: null, state: "not_available" as const }
        : { fact_id: target.fact_id, field: target.field as EvidenceRequest["change"]["field"], value, state };
    setBusy(true);
    await onSubmit({
      event_id: eventId(`${inv.case_version}|${JSON.stringify(change)}`),
      case_version: inv.case_version,
      change,
    });
    setBusy(false);
  }

  return (
    <form onSubmit={submit} data-tour="next-question" className="rounded-[6px] border border-ink bg-paper p-3.5">
      <p className="smallcaps flex items-center gap-1.5 text-ink-3">
        <MessageCircleQuestion className="size-3.5" aria-hidden /> For the {q.ask_role}
      </p>
      <p className="mt-1.5 font-serif text-[19px] leading-snug text-ink">{q.text}</p>
      <p className="mt-2 text-[11.5px] text-ink-3">
        {q.asked_at === null ? "Not asked yet" : `Asked on ${day(q.asked_at)}`}
        {target && ` · answers: ${target.label.toLowerCase()}`}
      </p>

      <fieldset className="mt-3.5" disabled={busy}>
        <legend className="sr-only">Answer</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["value", isDay ? "Give a day" : "Give the reason"],
              ["not_available", "Not available"],
              ["skip", "Skip for now"],
            ] as [Choice, string][]
          ).map(([c, label]) => (
            <label key={c}>
              <input type="radio" name={`answer-${q.id}`} className="peer sr-only" checked={choice === c} onChange={() => setChoice(c)} />
              <span className={pill}>{label}</span>
            </label>
          ))}
        </div>

        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={choice}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-3"
          >
            {choice === "value" &&
              (isDay ? (
                <DayInput value={dayValue} onChange={setDayValue} max={asOf} />
              ) : (
                <>
                  {suggestions && suggestions.length > 0 && (
                    <div data-tour="suggestions" className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] text-ink-3">Try:</span>
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setText(s)}
                          aria-pressed={text.trim() === s}
                          className={cn(
                            "rounded-full border px-3 py-1 text-[12.5px] transition-colors",
                            text.trim() === s ? "border-amber-ink bg-amber-wash text-ink" : "border-amber bg-paper text-ink hover:bg-amber-wash/60",
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="e.g. what the letter or the doctor said"
                    aria-label="Reason"
                    className={field}
                  />
                </>
              ))}
            {choice === "value" && (
              <p className="mt-1.5 text-[11.5px] text-ink-3">Recorded as: {STATE_LABEL[state].toLowerCase()}.</p>
            )}
            {choice === "not_available" && (
              <p className="text-[12px] text-ink-2">
                Recorded as &ldquo;not available&rdquo;. It is never read as &ldquo;no&rdquo;, and the finding keeps the gap visible.
              </p>
            )}
            {choice === "skip" && <p className="text-[12px] text-ink-2">Nothing is recorded. The question stays open for later.</p>}
          </motion.div>
        </AnimatePresence>
      </fieldset>

      {stale ? (
        <div role="alert" className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-l-[3px] border-coral bg-coral-wash/60 px-3 py-2">
          <span className="text-[13px] text-ink">This case changed. Reload to see the latest.</span>
          <Button type="button" size="sm" variant="outline" onClick={onReload}>
            <RefreshCw className="size-3.5" /> Reload
          </Button>
        </div>
      ) : (
        <div className="mt-3.5 flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" data-tour="answer-submit" disabled={busy || !ready || (!live && choice !== "skip")}>
            {busy ? "Recording…" : choice === "skip" ? "Skip for now" : tech ? `Record answer on case v${inv.case_version}` : "Record answer"}
          </Button>
          {!live && choice !== "skip" && <span className="text-[11.5px] text-ink-3">Answers need the live API.</span>}
        </div>
      )}
    </form>
  );
}
