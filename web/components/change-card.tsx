"use client";

// What one evidence change did: the fact before and after, and each affected finding before and
// after (from the response's finding_changes). Nothing else on the page was re-evaluated.

import { motion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { FIELD_LABEL, STATE_LABEL, STATUS, day, shortHeadline } from "@/lib/present";
import { useTech } from "@/lib/tech";
import type { AnswerState, EvidenceResult, TimelineResponse } from "@/lib/types";
import { StatusChip } from "./status";

const SKIP = new Set(["id", "patient_id", "label", "effect", "ingredient"]);
// Bookkeeping fields: shown only with technical details.
const TECHNICAL = new Set(["version", "recorded_at"]);
// A missing value, as the API words it too (api/store.py NOT_RECORDED).
const NOT_RECORDED = "not recorded";
export const NOTHING_RE_EVALUATED = "Nothing depends on this fact, so nothing changed: no finding was re-checked.";

const DAY_FIELDS = new Set(["happened_at", "stop_day", "recorded_at"]);
const STATE_FIELDS = new Set(["state", "indication_state"]);

function plain(key: string, v: unknown): string {
  if (Array.isArray(v)) return `${v.length} source${v.length === 1 ? "" : "s"}`;
  if (v === null || v === undefined || v === "") return NOT_RECORDED;
  if (DAY_FIELDS.has(key) && typeof v === "number") return day(v);
  if (STATE_FIELDS.has(key) && typeof v === "string" && v in STATE_LABEL) return STATE_LABEL[v as AnswerState].toLowerCase();
  return String(v);
}

export function BeforeAfter({ result }: { result: EvidenceResult }) {
  const tech = useTech();
  const keys = Object.keys(result.after).filter(
    (k) =>
      !SKIP.has(k) &&
      (tech || !TECHNICAL.has(k)) &&
      JSON.stringify(result.before[k]) !== JSON.stringify(result.after[k]),
  );
  const raw = (v: unknown) =>
    Array.isArray(v) ? `${v.length} source${v.length === 1 ? "" : "s"}` : v === null || v === undefined || v === "" ? NOT_RECORDED : String(v);
  const show = (k: string, v: unknown) => (tech ? raw(v) : plain(k, v));
  return (
    <table className={tech ? "mt-2 w-full border-collapse font-mono text-[11px]" : "mt-2 w-full border-collapse text-[12.5px]"}>
      <thead>
        <tr className="text-left text-ink-3">
          <th className="py-1 font-normal">{tech ? "field" : "What"}</th>
          <th className="py-1 font-normal">{tech ? "before" : "Before"}</th>
          <th className="py-1 font-normal">{tech ? "after" : "Now"}</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-rule">
            <td className="py-1 pr-2 text-ink-3">{tech ? k : (FIELD_LABEL[k] ?? k)}</td>
            <td className="py-1 pr-2 text-ink-3 line-through decoration-ink-3/50">{show(k, result.before[k])}</td>
            <td className="break-words py-1 text-ink">{show(k, result.after[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function factName(id: string, timeline: TimelineResponse) {
  const fact = [...timeline.episodes, ...timeline.observations].find((x) => x.id === id);
  return fact ? ("label" in fact ? fact.label : fact.ingredient.name) : id;
}

export function ChangeCard({
  result,
  timeline,
  onDismiss,
}: {
  result: EvidenceResult;
  timeline: TimelineResponse;
  onDismiss: () => void;
}) {
  const tech = useTech();
  const factId = String(result.after.id ?? "");
  const reason = new Map(result.new_revisions.map((r) => [r.finding_id, r.reason]));
  const n = result.finding_changes.length;
  return (
    <motion.section
      aria-label="What changed"
      data-tour="change-card"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.3 }}
      className="mb-4 rounded-[6px] border border-ink bg-paper p-3.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="smallcaps text-ink-3">
            What changed
            {tech && ` · case v${result.case_version_before} → v${result.case_version}`}
            {result.replayed && " · sent again, nothing new was written"}
          </p>
          <p className="mt-1 font-serif text-[19px] leading-snug text-ink">{factName(factId, timeline)}</p>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="rounded-[4px] p-1 text-ink-3 hover:bg-rule/50 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <BeforeAfter result={result} />

      <h3 className="smallcaps mt-3.5 text-ink-3">
        Findings re-checked <span className="tabular">{n}</span>
      </h3>
      {n === 0 ? (
        <p className="mt-1 text-[13px] text-ink-2">{NOTHING_RE_EVALUATED}</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] font-medium text-ink">
            {n === 1
              ? "Only this finding was re-checked. Nothing else was touched."
              : `Only these ${n} findings were re-checked. Nothing else was touched.`}
          </p>
          <ul className="mt-2 space-y-3">
            {result.finding_changes.map((c) => (
              <li key={c.finding_id} className="border-l-2 border-amber pl-3">
                <p className="text-[13px] text-ink">{shortHeadline(c.after.headline)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusChip status={c.before.status} className="opacity-60" />
                    <span className="whitespace-nowrap text-[11px] text-ink-3">version {c.before.revision_n}</span>
                  </span>
                  <ArrowRight className="size-3.5 text-ink-3" aria-label="then" />
                  <span className="inline-flex items-center gap-1.5">
                    <StatusChip status={c.after.status} />
                    <span className="whitespace-nowrap text-[11px] text-ink">version {c.after.revision_n}</span>
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">{STATUS[c.after.status].blurb}</p>
                {reason.get(c.finding_id) && <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{reason.get(c.finding_id)}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {result.pending_reevaluation_ids.length > 0 && (
        <p className="mt-2 text-[11.5px] text-ink-3">
          Waiting to be re-checked: {result.pending_reevaluation_ids.length} finding
          {result.pending_reevaluation_ids.length === 1 ? "" : "s"}.
        </p>
      )}
    </motion.section>
  );
}
