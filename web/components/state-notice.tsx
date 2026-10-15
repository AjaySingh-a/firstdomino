"use client";

// The distinct interface states. "Evaluation unavailable" must never read as "no pattern".
import { motion } from "framer-motion";
import { AlertTriangle, CircleDashed, HelpCircle, RefreshCw, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

type Tone = "error" | "amber" | "neutral";

const TONE: Record<Tone, string> = {
  error: "border-coral bg-coral-wash/60",
  amber: "border-amber bg-amber-wash/60",
  neutral: "border-rule-strong bg-paper",
};

const ICON: Record<Tone, string> = { error: "text-coral", amber: "text-amber-ink", neutral: "text-ink-3" };

function Notice({
  tone,
  icon,
  title,
  children,
  action,
  className,
}: {
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      role={tone === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("rounded-[6px] border border-l-[3px] px-4 py-3 text-ink", TONE[tone], className)}
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-1 shrink-0", ICON[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[19px] leading-tight">{title}</p>
          <div className="mt-1 text-[13px] leading-relaxed text-ink-2">{children}</div>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </motion.div>
  );
}

export function LoadingState({
  label = "Reading the medication story",
  lines = 4,
  className,
}: {
  label?: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("space-y-3", className)}>
      <p className="smallcaps flex items-center gap-2 text-ink-3">
        <CircleDashed className="size-3.5 animate-spin [animation-duration:2.4s]" aria-hidden />
        {label}
      </p>
      {Array.from({ length: lines }, (_, i) => (
        <motion.div
          key={i}
          className="h-3 rounded-[2px] bg-rule/70"
          style={{ width: `${92 - i * 13}%` }}
          animate={{ opacity: [0.45, 0.9, 0.45] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.12 }}
        />
      ))}
    </div>
  );
}

export function UnavailableState({
  message,
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Notice
      tone="error"
      icon={<AlertTriangle className="size-4" />}
      title="Evaluation unavailable"
      className={className}
      action={
        onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="size-3.5" /> Try again
          </Button>
        )
      }
    >
      FirstDomino could not evaluate this story right now, so nothing can be said either way. This is{" "}
      <strong className="font-medium text-ink">not</strong> a &ldquo;no pattern&rdquo; result.
      {message && <span className="mt-1 block font-mono text-[11px] text-ink-3">{message}</span>}
    </Notice>
  );
}

export function InsufficientEvidenceState({ missing, className }: { missing?: string[]; className?: string }) {
  return (
    <Notice tone="amber" icon={<HelpCircle className="size-4" />} title="Insufficient evidence" className={className}>
      The timing fits a curated pattern, but the review depends on{" "}
      {missing && missing.length > 0 ? (
        <>
          facts that are not known yet: <span className="text-ink">{missing.join("; ")}</span>.
        </>
      ) : (
        "facts that are not known yet."
      )}{" "}
      The next question asks for them.
    </Notice>
  );
}

export function NoMatchState({ patterns, className }: { patterns?: number; className?: string }) {
  const which = patterns === undefined ? "the curated patterns" : `the ${patterns} curated pattern${patterns === 1 ? "" : "s"}`;
  return (
    <Notice tone="neutral" icon={<SearchX className="size-4" />} title="No matched pattern" className={className}>
      The evaluation ran, and none of {which} matched this story. FirstDomino only knows a few cited patterns,
      so this says nothing about patterns outside that list.
    </Notice>
  );
}

export function StaleState({
  sent,
  current,
  onReload,
  className,
}: {
  sent: number;
  current: number;
  onReload?: () => void;
  className?: string;
}) {
  return (
    <Notice
      tone="error"
      icon={<RefreshCw className="size-4" />}
      title="This case changed. Reload"
      className={className}
      action={
        onReload && (
          <Button size="sm" onClick={onReload}>
            <RefreshCw className="size-3.5" /> Reload
          </Button>
        )
      }
    >
      The case changed while you were working: your change was prepared against version {sent}, and
      the case is now at version {current}. Nothing was saved (HTTP 409). Reload, re-check the evidence, then try again.
    </Notice>
  );
}
