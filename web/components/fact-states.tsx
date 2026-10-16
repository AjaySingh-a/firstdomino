import type { FactRef } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StateTag } from "./status";

/**
 * Each fact's state, straight from the record (FactRef.state). Shown next to any text the review agent
 * phrased, because the agent is never allowed to say how certain a fact is.
 */
export function FactStates({ refs, className }: { refs: FactRef[]; className?: string }) {
  if (!refs.length) return null;
  return (
    <div className={cn("mt-2 border-t border-rule pt-2", className)}>
      <p className="smallcaps text-[10px] text-ink-3">How certain each fact is · from the record</p>
      <ul className="mt-1 space-y-0.5">
        {refs.map((r) => (
          <li key={`${r.fact_id}:${r.field}`} className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="min-w-0 truncate text-ink-2">{r.label}</span>
            <StateTag state={r.state} className="shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}
