"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bot, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AgentStep, InvestigationResponse, ReviewAgentResult, TimelineResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { factName } from "./change-card";
import { FactStates } from "./fact-states";
import { Button } from "./ui/button";

const PHRASING: Record<ReviewAgentResult["phrasing"], string> = {
  llm: "Text phrased by the model, checked against the evidence IDs it was given.",
  template: "Text from deterministic templates (no model key, or the model's reply did not pass the checks).",
  mixed: "Some text phrased by the model; where a reply did not pass the checks, the template was used.",
};

const runOf = (id: string) => /:run-(\d+)-step-/.exec(id)?.[1] ?? null;
const toolOf = (s: AgentStep) => (typeof s.args.agent_tool === "string" ? s.args.agent_tool : s.tool);
const strings = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);

/** args.fallback_reason (agent/review_agent.py): why a step used the template instead of the model. */
const FALLBACK: Record<string, string> = {
  no_key: "no LLM key set",
  rate_limited: "too many agent runs from this address; try again in a minute",
  http_400: "request refused (HTTP 400)",
  http_401: "LLM key rejected (HTTP 401)",
  http_403: "LLM key not allowed (HTTP 403)",
  http_404: "model not found (HTTP 404)",
  http_429: "quota or rate limit (HTTP 429)",
  http_500: "LLM server error (HTTP 500)",
  http_502: "LLM server error (HTTP 502)",
  http_503: "model busy (HTTP 503)",
  http_504: "LLM gateway timeout (HTTP 504)",
  timeout: "no answer in time",
  unreachable: "LLM endpoint unreachable",
  invalid_json: "reply was not the expected JSON",
  invalid_tool: "picked a tool not allowed at this step",
  unknown_id: "cited an ID no tool returned",
  invented_fact: "added a day, medicine or reason not in the evidence",
  copy_rules: "broke the copy rules",
  certainty_words: "said how certain a fact is (that comes from the record)",
};
const fallbackLabel = (code: string) => FALLBACK[code] ?? code;

/** Steps grouped by pass (":run-<n>-step-"), newest first. Seeded steps without a run go last. */
function byRun(steps: AgentStep[]) {
  const groups = new Map<string, AgentStep[]>();
  for (const s of steps) {
    const key = runOf(s.id) ?? "seed";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "seed" ? 1 : b === "seed" ? -1 : Number(b) - Number(a)));
}

export function AgentPanel({
  inv,
  timeline,
  stale,
  onRan,
  onError,
}: {
  inv: InvestigationResponse;
  timeline: TimelineResponse;
  stale: boolean;
  onRan: () => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const fid = inv.finding.id;
  const pid = inv.patient_id;
  const [history, setHistory] = useState<AgentStep[] | null>(null);
  const [live, setLive] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<ReviewAgentResult | null>(null);
  const [running, setRunning] = useState(false);
  const alive = useRef(true);

  const loadHistory = useCallback(async () => {
    try {
      const r = await api.agentSteps(pid);
      if (alive.current) setHistory(r.steps.filter((s) => s.finding_id === fid));
    } catch {
      if (alive.current) setHistory([]);
    }
  }, [pid, fid]);

  useEffect(() => {
    alive.current = true;
    void loadHistory();
    return () => {
      alive.current = false;
    };
  }, [loadHistory, inv.case_version]);

  async function run() {
    setRunning(true);
    setResult(null);
    setLive([]);
    let before = new Set<string>();
    try {
      before = new Set((await api.agentSteps(pid)).steps.map((s) => s.id));
    } catch {
      // the run itself reports any failure
    }
    // Steps are persisted as each tool runs, so polling shows them as they come in.
    const poll = setInterval(async () => {
      try {
        const r = await api.agentSteps(pid);
        if (alive.current) setLive(r.steps.filter((s) => s.finding_id === fid && !before.has(s.id)));
      } catch {
        // keep the last view; the run's own result follows
      }
    }, 400);
    try {
      const res = await api.runReviewAgent(fid, { case_version: inv.case_version });
      if (alive.current) {
        setLive(res.steps);
        setResult(res);
      }
      await onRan();
    } catch (err) {
      onError(err);
    } finally {
      clearInterval(poll);
      if (alive.current) setRunning(false);
      void loadHistory();
    }
  }

  const all = history ?? [];

  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-ink-3">
        One bounded pass over six allowlisted tools. It reads the evidence, finds the next missing fact, records the
        question, checks which findings depend on that fact (read-only) and drafts the next conversation with the
        clinician. It cannot answer questions, change facts, or write findings or decisions.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={run} disabled={running || stale}>
          <Bot className="size-3.5" aria-hidden />
          {running ? "Running…" : "Run review agent"}
        </Button>
        {stale && <span className="text-[12px] text-ink-3">Reload the case first.</span>}
      </div>

      {(running || live.length > 0) && (
        <section aria-live="polite" className="mt-4">
          <h4 className="smallcaps text-ink-3">This run</h4>
          <ol className="mt-2 space-y-3">
            <AnimatePresence initial={false}>
              {live.map((s, i) => (
                <StepRow key={s.id} n={i + 1} step={s} timeline={timeline} />
              ))}
            </AnimatePresence>
            {running && (
              <li className="flex items-center gap-2 pl-6 text-[12px] italic text-ink-3">
                <span className="size-1.5 animate-pulse rounded-full bg-amber" aria-hidden />
                working on the next step…
              </li>
            )}
          </ol>
        </section>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-3">
          <p className="text-[11.5px] text-ink-3">
            {PHRASING[result.phrasing]}
            {(() => {
              const reasons = [...new Set(result.steps.map((s) => s.args.fallback_reason).filter((r): r is string => typeof r === "string"))];
              return reasons.length ? ` Why: ${reasons.map(fallbackLabel).join("; ")}.` : "";
            })()}
          </p>
          {result.question ? (
            <div className="rounded-[4px] border border-l-[3px] border-amber bg-amber-wash/40 px-3 py-2">
              <p className="smallcaps text-[10px] text-amber-ink">Question recorded for the {result.question.ask_role}</p>
              <p className="mt-1 font-serif text-[16px] leading-snug text-ink">&ldquo;{result.question.text}&rdquo;</p>
              <p className="mt-1 text-[11.5px] text-ink-3">The agent asked it; only a person can answer it.</p>
              <FactStates refs={inv.unknowns.filter((u) => u.requirement_id === result.question?.requirement_id)} />
            </div>
          ) : (
            <p className="text-[12.5px] italic text-ink-3">No question asked: nothing open is waiting to be asked.</p>
          )}
          {result.packet_text && (
            <div className="rounded-[4px] border border-rule-strong bg-paper px-3 py-2">
              <p className="smallcaps text-[10px] text-ink-3">The next conversation to have with the clinician</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink">{result.packet_text}</p>
              <FactStates refs={[...inv.documented, ...inv.conflicts, ...inv.unknowns]} />
              <Link
                href={`/packet/${encodeURIComponent(pid)}`}
                className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
              >
                Open the printable packet <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
          )}
        </motion.div>
      )}

      <details className="group mt-5 border-t border-ink pt-3">
        <summary className="smallcaps flex cursor-pointer list-none items-center gap-1 text-ink-3 hover:text-ink">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
          Every recorded step <span className="tabular">{history === null ? "" : `(${all.length})`}</span>
        </summary>
        {history === null ? (
          <p className="mt-2 text-[12px] italic text-ink-3">Loading…</p>
        ) : all.length === 0 ? (
          <p className="mt-2 text-[12px] italic text-ink-3">No steps recorded for this finding yet.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {byRun(all).map(([run, steps]) => (
              <section key={run}>
                <h5 className="font-mono text-[10.5px] text-ink-3">
                  {run === "seed" ? "recorded with the story" : `run ${run}`} · {steps.length} step{steps.length === 1 ? "" : "s"}
                  {steps.some((s) => !s.ok) && <span className="text-coral"> · {steps.filter((s) => !s.ok).length} failed</span>}
                </h5>
                <ol className="mt-2 space-y-3">
                  {steps.map((s, i) => (
                    <StepRow key={s.id} n={i + 1} step={s} timeline={timeline} showId />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}

function StepRow({ n, step, timeline, showId }: { n: number; step: AgentStep; timeline: TimelineResponse; showId?: boolean }) {
  const name = (id: string) => {
    const label = factName(id, timeline);
    return label === id ? id.slice(id.indexOf(":") + 1) : label;
  };
  const rejected = strings(step.args.rejected);
  const error = typeof step.args.error === "string" ? step.args.error : null;
  const phrasing = typeof step.args.phrasing === "string" ? step.args.phrasing : null;
  const fallback = typeof step.args.fallback_reason === "string" ? step.args.fallback_reason : null;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn("relative border-l pl-4", step.ok ? "border-ink" : "border-coral")}
    >
      <span
        className={cn("absolute -left-[5px] top-1 size-[9px] rounded-full border", step.ok ? "border-ink bg-ink" : "border-coral bg-coral")}
        aria-hidden
      />
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[11px] text-ink-3">{n}.</span>
        <span className="font-mono text-[12px] text-ink">{toolOf(step)}</span>
        <span className="font-mono text-[10.5px] text-ink-3">{step.tool}</span>
        <span className={cn("smallcaps text-[10px]", step.ok ? "text-teal" : "text-coral")}>{step.ok ? "ok" : "failed"}</span>
        {phrasing && <span className="text-[10.5px] text-ink-3">· {phrasing}</span>}
        {fallback && (
          <span
            title={`fallback_reason: ${fallback}`}
            className="rounded-[3px] border border-amber/70 bg-amber-wash/50 px-1 font-mono text-[10px] text-amber-ink"
          >
            {fallback}
          </span>
        )}
      </p>
      {fallback && <p className="text-[11px] text-ink-3">Template used: {fallbackLabel(fallback)}.</p>}
      {showId && <p className="font-mono text-[10px] text-ink-3">{step.id}</p>}
      {step.result_ids.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`IDs returned by step ${n}`}>
          {step.result_ids.map((id) => (
            <li
              key={id}
              title={id}
              className="max-w-full truncate rounded-[3px] border border-rule-strong bg-paper px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
            >
              {name(id)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 font-mono text-[10.5px] italic text-ink-3">returned no IDs</p>
      )}
      {error && <p className="mt-1 text-[12px] text-coral">{error}</p>}
      {rejected.length > 0 && (
        <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
          {phrasing === "template" ? "Attempts" : "First reply not used"}: {rejected.join("; ")}.
        </p>
      )}
    </motion.li>
  );
}
