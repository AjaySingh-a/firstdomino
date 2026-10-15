import { cn } from "@/lib/utils";
import { STATE_LABEL, STATUS, type Tone } from "@/lib/present";
import type { AnswerState, FindingStatus } from "@/lib/types";

const TONE: Record<Tone, string> = {
  amber: "border-amber bg-amber-wash text-amber-ink",
  teal: "border-teal bg-teal-wash text-teal",
  muted: "border-rule-strong bg-paper text-ink-3",
};

const DOT: Record<Tone, string> = { amber: "bg-amber", teal: "bg-teal", muted: "bg-ink-3" };

export function StatusChip({ status, className }: { status: FindingStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONE[s.tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[s.tone])} />
      {s.label}
    </span>
  );
}

const MARK: Record<AnswerState, string> = {
  documented: "border-ink bg-ink",
  reported: "border-ink bg-transparent",
  conflicting: "border-amber hatch-amber",
  unknown: "border-dashed border-ink-3 bg-transparent",
  not_available: "border-dashed border-ink-3 bg-transparent",
};

/** How certain a fact is. Shape carries the meaning as well as the words: solid, hollow, hatched, dashed. */
export function StateTag({ state, className }: { state: AnswerState; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-2", className)}>
      <span aria-hidden className={cn("size-2 rounded-full border", MARK[state])} />
      {STATE_LABEL[state]}
    </span>
  );
}
