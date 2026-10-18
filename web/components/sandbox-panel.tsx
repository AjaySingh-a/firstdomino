"use client";

// Synthetic scenario sandbox: edit one fact of the synthetic story and watch only the findings that
// depend on it change. Writes go through the same evidence endpoint as a real answer; Reset restores
// every synthetic story to its fixture.

import { FlaskConical, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { DATA_SOURCE } from "@/lib/api";
import { stripSynthetic } from "@/lib/present";
import { useTech } from "@/lib/tech";
import type { SandboxPreset } from "@/lib/tour";
import type { EvidenceRequest, TimelineResponse } from "@/lib/types";
import { DayInput, field, pill, useEventId, type SubmitEvidence } from "./next-question";
import { Button } from "./ui/button";

type Kind = "onset" | "start" | "indication";
type ValueState = "documented" | "reported";

export function SandboxPanel({
  timeline,
  onSubmit,
  onReset,
  preset,
}: {
  timeline: TimelineResponse;
  onSubmit: SubmitEvidence;
  onReset: () => Promise<void>;
  /** A change the guided tour fills in for the visitor to apply. */
  preset?: SandboxPreset;
}) {
  const tech = useTech();
  const { patient, observations, episodes, sources } = timeline;
  const [kind, setKind] = useState<Kind>(observations.length ? "onset" : "indication");
  const [factId, setFactId] = useState("");
  const [dayValue, setDayValue] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<ValueState>("documented");
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState<"edit" | "reset" | null>(null);
  const eventId = useEventId(patient.id);
  const live = DATA_SOURCE === "live";

  useEffect(() => {
    if (!preset) return;
    setKind(preset.kind);
    setFactId(preset.factId);
    setDayValue(preset.day);
  }, [preset]);

  // Every medicine is listed, including ones no pattern involves: editing those re-evaluates nothing.
  const options =
    kind === "onset"
      ? observations.map((o) => ({ id: o.id, label: `${o.label} began`, current: o.happened_at, currentText: null }))
      : kind === "start"
        ? episodes.map((e) => ({ id: e.id, label: `${e.ingredient.name} started`, current: e.happened_at, currentText: null }))
        : episodes.map((e) => ({ id: e.id, label: `Reason for ${e.ingredient.name}`, current: null, currentText: e.indication }));
  const chosen = options.find((o) => o.id === factId) ?? options[0];
  const isDay = kind !== "indication";
  const value = isDay ? (dayValue ?? chosen?.current ?? null) : text.trim() || null;

  function pickKind(k: Kind) {
    setKind(k);
    setFactId("");
    setDayValue(null);
    setText("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen || value === null) return;
    const change: EvidenceRequest["change"] = {
      fact_id: chosen.id,
      field: isDay ? "happened_at" : "indication",
      value,
      state,
      source_id: sourceId || null,
    };
    setBusy("edit");
    await onSubmit({
      event_id: eventId(`${patient.case_version}|${JSON.stringify(change)}`),
      case_version: patient.case_version,
      change,
    });
    setBusy(null);
  }

  async function reset() {
    setBusy("reset");
    await onReset();
    setBusy(null);
  }

  return (
    <section
      aria-labelledby="sandbox-h"
      data-tour="sandbox"
      className="mt-6 rounded-[8px] border-2 border-dashed border-amber bg-amber-wash/30 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="smallcaps flex items-center gap-1.5 text-amber-ink">
            <FlaskConical className="size-3.5" aria-hidden /> Sandbox · not part of the record
          </p>
          <h2 id="sandbox-h" className="mt-1 font-serif text-[22px] leading-none text-ink">
            Synthetic scenario: edit a fact
          </h2>
          <p className="mt-1.5 max-w-[60ch] text-[12.5px] text-ink-2">
            Try another version of this story. Only findings that depend on the edited fact are re-checked. Reset
            restores all three stories.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reset} disabled={busy !== null || !live}>
          <RotateCcw className="size-3.5" /> {busy === "reset" ? "Resetting…" : "Reset all stories"}
        </Button>
      </div>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <fieldset className="sm:col-span-2" disabled={busy !== null}>
          <legend className="smallcaps mb-1.5 text-ink-3">Fact to edit</legend>
          <div className="flex flex-wrap gap-2">
            {observations.length > 0 && (
              <label>
                <input type="radio" name="sandbox-kind" className="peer sr-only" checked={kind === "onset"} onChange={() => pickKind("onset")} />
                <span className={pill}>Symptom onset date</span>
              </label>
            )}
            <label>
              <input type="radio" name="sandbox-kind" className="peer sr-only" checked={kind === "start"} onChange={() => pickKind("start")} />
              <span className={pill}>Medicine start date</span>
            </label>
            <label>
              <input type="radio" name="sandbox-kind" className="peer sr-only" checked={kind === "indication"} onChange={() => pickKind("indication")} />
              <span className={pill}>Reason a medicine was started</span>
            </label>
          </div>
        </fieldset>

        <label className="block">
          <span className="smallcaps mb-1.5 block text-ink-3">{kind === "onset" ? "Symptom" : "Medicine"}</span>
          <select
            value={chosen?.id ?? ""}
            onChange={(e) => {
              setFactId(e.target.value);
              setDayValue(null);
            }}
            className={field}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11.5px] text-ink-3">
            Now:{" "}
            {isDay
              ? chosen?.current === null || chosen?.current === undefined
                ? "date not known"
                : `day ${chosen.current}`
              : (chosen?.currentText ?? "not known yet")}
          </span>
        </label>

        <div className="block">
          <span className="smallcaps mb-1.5 block text-ink-3">
            {kind === "onset" ? "New onset day" : kind === "start" ? "New start day" : "New reason"}
          </span>
          {isDay ? (
            <div className="pt-2">
              <DayInput value={value as number | null} onChange={setDayValue} max={patient.as_of_day} />
            </div>
          ) : (
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. heart failure"
              className={field}
            />
          )}
        </div>

        <fieldset disabled={busy !== null}>
          <legend className="smallcaps mb-1.5 text-ink-3">Recorded as</legend>
          <div className="flex flex-wrap gap-2">
            {(["documented", "reported"] as ValueState[]).map((s) => (
              <label key={s}>
                <input type="radio" name="sandbox-state" className="peer sr-only" checked={state === s} onChange={() => setState(s)} />
                <span className={pill}>{s === "documented" ? "Documented" : "Reported by caregiver"}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="smallcaps mb-1.5 block text-ink-3">Source (optional)</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={field}>
            <option value="">No new source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {stripSynthetic(s.label)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" data-tour="sandbox-apply" disabled={busy !== null || !live || !chosen || value === null}>
            {busy === "edit" ? "Applying…" : tech ? `Apply to synthetic case v${patient.case_version}` : "Apply this change"}
          </Button>
          {!live && <span className="text-[11.5px] text-ink-3">The sandbox needs the live API (NEXT_PUBLIC_DATA_SOURCE=live).</span>}
        </div>
      </form>
    </section>
  );
}
