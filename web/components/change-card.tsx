"use client";

// What one evidence change did: the fact before and after, and each affected finding before and
// after (from the response's finding_changes). Nothing else on the page was re-evaluated.

import { motion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { shortHeadline } from "@/lib/present";
import type { EvidenceResult, TimelineResponse } from "@/lib/types";
import { StatusChip } from "./status";

const SKIP = new Set(["id", "patient_id", "label", "effect", "ingredient"]);

export function BeforeAfter({ result }: { result: EvidenceResult }) {
  const keys = Object.keys(result.after).filter(
    (k) => !SKIP.has(k) && JSON.stringify(result.before[k]) !== JSON.stringify(result.after[k]),
  );
  const show = (v: unknown) => (Array.isArray(v) ? `${v.length} source${v.length === 1 ? "" : "s"}` : String(v ?? "—"));
  return (
    <table className="mt-2 w-full border-collapse font-mono text-[11px]">
      <thead>
        <tr className="text-left text-ink-3">
          <th className="py-1 font-normal">field</th>
          <th className="py-1 font-normal">before</th>
          <th className="py-1 font-normal">after</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-rule">
            <td className="py-1 pr-2 text-ink-3">{k}</td>
            <td className="py-1 pr-2 text-ink-3 line-through decoration-ink-3/50">{show(result.before[k])}</td>
            <td className="break-words py-1 text-ink">{show(result.after[k])}</td>
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
  const factId = String(result.after.id ?? "");
  const reason = new Map(result.new_revisions.map((r) => [r.finding_id, r.reason]));
  return (
    <motion.section
      aria-label="What changed"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.3 }}
      className="mb-4 rounded-[6px] border border-ink bg-paper p-3.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="smallcaps text-ink-3">
            What changed · case v{result.case_version_before} &rarr; v{result.case_version}
            {result.replayed && " · replayed"}
          </p>
          <p className="mt-1 font-serif text-[19px] leading-snug text-ink">{factName(factId, timeline)}</p>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="rounded-[4px] p-1 text-ink-3 hover:bg-rule/50 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <BeforeAfter result={result} />

      <h3 className="smallcaps mt-3.5 text-ink-3">
        Findings re-evaluated <span className="tabular">{result.finding_changes.length}</span>
      </h3>
      {result.finding_changes.length === 0 ? (
        <p className="mt-1 text-[12.5px] italic text-ink-3">No finding depends on this fact, so none was re-evaluated.</p>
      ) : (
        <ul className="mt-1.5 space-y-3">
          {result.finding_changes.map((c) => (
            <li key={c.finding_id} className="border-l-2 border-amber pl-3">
              <p className="text-[13px] text-ink">{shortHeadline(c.after.headline)}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <StatusChip status={c.before.status} className="opacity-60" />
                  <span className="whitespace-nowrap font-mono text-[10.5px] text-ink-3">rev {c.before.revision_n}</span>
                </span>
                <ArrowRight className="size-3.5 text-ink-3" aria-label="then" />
                <span className="inline-flex items-center gap-1.5">
                  <StatusChip status={c.after.status} />
                  <span className="whitespace-nowrap font-mono text-[10.5px] text-ink">rev {c.after.revision_n}</span>
                </span>
              </div>
              {reason.get(c.finding_id) && <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{reason.get(c.finding_id)}</p>}
            </li>
          ))}
        </ul>
      )}
      {result.pending_reevaluation_ids.length > 0 && (
        <p className="mt-2 text-[11.5px] text-ink-3">
          Waiting for re-evaluation: {result.pending_reevaluation_ids.length} finding
          {result.pending_reevaluation_ids.length === 1 ? "" : "s"}.
        </p>
      )}
    </motion.section>
  );
}
