"use client";

import { motion } from "framer-motion";
import { FileClock } from "lucide-react";
import { FIELD_LABEL, SOURCE_KIND, STATE_LABEL, day, shortDay, stripSynthetic } from "@/lib/present";
import { Tech } from "@/lib/tech";
import type { EvidenceRequest, TimelineResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

interface Props {
  timeline: TimelineResponse;
  lit: Set<string> | null;
  onConfirm: (req: EvidenceRequest) => void;
  busyEventId: string | null;
}

export function SourceList({ timeline, lit, onConfirm, busyEventId }: Props) {
  const sources = [...timeline.sources].sort(
    (a, b) => (a.happened_at ?? Infinity) - (b.happened_at ?? Infinity) || a.recorded_at - b.recorded_at,
  );
  const facts = new Map([...timeline.episodes, ...timeline.observations].map((f) => [f.id, f]));
  const sourceLabel = new Map(timeline.sources.map((s) => [s.id, stripSynthetic(s.label)]));

  return (
    <div className="space-y-6">
      <section aria-labelledby="sources-h">
        <h2 id="sources-h" className="smallcaps mb-3 flex items-baseline justify-between text-ink-3">
          Sources <span className="tabular normal-case tracking-normal">{sources.length}</span>
        </h2>
        <ol className="divide-y divide-rule border-y border-rule">
          {sources.map((s) => {
            const on = !lit || lit.has(s.id);
            const lag = s.happened_at === null ? null : s.recorded_at - s.happened_at;
            return (
              <motion.li
                key={s.id}
                animate={{ opacity: on ? 1 : 0.28 }}
                transition={{ duration: 0.3 }}
                className="py-2.5"
              >
                <p className="smallcaps text-[10px] text-ink-3">{SOURCE_KIND[s.kind].label}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink">{stripSynthetic(s.label)}</p>
                <dl className="tabular mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-ink-2">
                  <div className="flex gap-1">
                    <dt className="text-ink-3">happened</dt>
                    <dd>{shortDay(s.happened_at)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-ink-3">recorded</dt>
                    <dd>{shortDay(s.recorded_at)}</dd>
                  </div>
                  {lag !== null && lag > 0 && <dd className="text-amber-ink">+{lag} d later</dd>}
                </dl>
              </motion.li>
            );
          })}
        </ol>
      </section>

      {timeline.pending_evidence.length > 0 && (
        <section aria-labelledby="pending-h">
          <h2 id="pending-h" className="smallcaps mb-3 flex items-center gap-1.5 text-amber-ink">
            <FileClock className="size-3.5" aria-hidden /> Waiting to be confirmed
          </h2>
          <ul className="space-y-3">
            {timeline.pending_evidence.map((req, i) => {
              const fact = facts.get(req.change.fact_id);
              const name = fact ? ("label" in fact ? fact.label : fact.ingredient.name) : req.change.fact_id;
              const current = fact ? (fact as unknown as Record<string, unknown>)[req.change.field] : undefined;
              const isDay = req.change.field === "happened_at" || req.change.field === "stop_day";
              const fmt = (v: unknown) => (isDay ? day(v as number | null) : String(v ?? "not known"));
              return (
                <li
                  key={req.event_id}
                  data-tour={i === 0 ? "pending" : undefined}
                  className="rounded-[6px] border border-dashed border-amber bg-paper p-3"
                >
                  <p className="text-[13px] text-ink">
                    {name}: {(FIELD_LABEL[req.change.field] ?? req.change.field).toLowerCase()}
                  </p>
                  <p className="tabular mt-1 font-mono text-[12px]">
                    <span className="text-ink-3 line-through decoration-ink-3/60">{fmt(current)}</span>
                    <span className="mx-1.5 text-ink-3">&rarr;</span>
                    <span className="text-ink">{fmt(req.change.value)}</span>
                    <span className="ml-1.5 text-ink-3">({STATE_LABEL[req.change.state].toLowerCase()})</span>
                  </p>
                  {req.change.source_id && (
                    <p className="mt-1 text-[12px] text-ink-2">From: {sourceLabel.get(req.change.source_id) ?? req.change.source_id}</p>
                  )}
                  <Tech>
                    <p className="mt-1 font-mono text-[11px] text-ink-3">
                      {req.event_id} · prepared against v{req.case_version}
                    </p>
                  </Tech>
                  <Button
                    size="sm"
                    variant="outline"
                    data-tour={i === 0 ? "pending-confirm" : undefined}
                    className="mt-3 w-full"
                    disabled={busyEventId === req.event_id}
                    onClick={() => onConfirm(req)}
                  >
                    {busyEventId === req.event_id ? "Confirming…" : "Confirm correction"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
