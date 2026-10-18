"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, ChevronRight } from "lucide-react";
import { useState } from "react";
import queriesJson from "@/lib/fixtures/queries.json";
import {
  DECISION_LABEL,
  STATUS,
  day,
  querySentence,
  sourceById,
  stripSynthetic,
} from "@/lib/present";
import { Tech, useTech } from "@/lib/tech";
import type { DrawerTab } from "@/lib/tour";
import type {
  EvidenceResult,
  FactRef,
  FindingRevision,
  InvestigationResponse,
  ReviewChoice,
  ReviewRequest,
  ReviewerRole,
  TimelineResponse,
} from "@/lib/types";
import type { Loadable } from "@/lib/use-workspace";
import { cn } from "@/lib/utils";
import { AgentPanel } from "./agent-panel";
import { BeforeAfter, ChangeCard, factName } from "./change-card";
import { Help } from "./help";
import { NextQuestion, type SubmitEvidence } from "./next-question";
import { InsufficientEvidenceState, LoadingState, UnavailableState } from "./state-notice";
import { StateTag, StatusChip } from "./status";
import { useTour } from "./tour";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const QUERIES = queriesJson as Record<string, string>;

interface Props {
  state: Loadable<InvestigationResponse> | null;
  timeline: TimelineResponse;
  evidenceResults: EvidenceResult[];
  lastChange: EvidenceResult | null;
  stale: boolean;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  /** Answers the guided tour offers for the next question. */
  suggestions?: string[];
  onSubmitEvidence: SubmitEvidence;
  onDismissChange: () => void;
  onReview: (fid: string, body: ReviewRequest) => Promise<boolean>;
  onAgentRan: () => Promise<void>;
  onError: (err: unknown) => void;
  onRetry: () => void;
}

export function InvestigationDrawer({
  state,
  timeline,
  evidenceResults,
  lastChange,
  stale,
  tab,
  onTabChange,
  suggestions,
  onSubmitEvidence,
  onDismissChange,
  onReview,
  onAgentRan,
  onError,
  onRetry,
}: Props) {
  if (!state) {
    return (
      <div className="py-10 text-center">
        <p className="font-serif text-2xl text-ink-2">No finding selected</p>
        <p className="mx-auto mt-2 max-w-[28ch] text-[13px] text-ink-3">
          Click an amber arc on the timeline to see what is on record and what is missing.
        </p>
      </div>
    );
  }
  if (state.kind === "loading") return <LoadingState label="Assembling the evidence" lines={6} />;
  if (state.kind === "unavailable") return <UnavailableState message={state.message} onRetry={onRetry} />;

  const inv = state.data;
  const f = inv.finding;
  return (
    <motion.div key={f.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>
      <header className="border-b border-ink pb-4">
        <p className="smallcaps flex items-center gap-1 text-ink-3">
          Investigation
          <Help text="One possible pattern: what is on record, what is not known yet, and the one fact that would settle it." />
        </p>
        <h2 className="mt-1 font-serif text-[26px] leading-[1.1] text-ink">{f.headline}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusChip status={f.status} />
          <span className="text-[11.5px] text-ink-3">version {f.revision_n}</span>
          <Tech>
            <span className="font-mono text-[11px] text-ink-3">
              {f.status} · rev {f.revision_n} · pattern v{f.pattern_version} · case v{inv.case_version} · {f.id}
            </span>
          </Tech>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{STATUS[f.status].blurb}</p>
      </header>

      <AnimatePresence>
        {lastChange && (
          <div className="mt-4">
            <ChangeCard key={lastChange.event_id} result={lastChange} timeline={timeline} onDismiss={onDismissChange} />
          </div>
        )}
      </AnimatePresence>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as DrawerTab)} className="mt-4">
        <TabsList className="flex-wrap gap-x-6 gap-y-1">
          <TabsTrigger value="investigation">Evidence</TabsTrigger>
          <TabsTrigger value="history">
            Review history <span className="ml-1 tabular text-ink-3">{inv.revisions.length}</span>
          </TabsTrigger>
          <TabsTrigger value="agent">Review assistant</TabsTrigger>
        </TabsList>
        <TabsContent value="investigation">
          <Investigation
            inv={inv}
            timeline={timeline}
            stale={stale}
            suggestions={suggestions}
            onSubmitEvidence={onSubmitEvidence}
            onReload={onRetry}
          />
        </TabsContent>
        <TabsContent value="history">
          <History inv={inv} timeline={timeline} evidenceResults={evidenceResults} onReview={onReview} />
        </TabsContent>
        <TabsContent value="agent">
          <AgentPanel inv={inv} timeline={timeline} stale={stale} onRan={onAgentRan} onError={onError} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

// ---------- Evidence: five fixed parts ----------

function Part({
  n,
  title,
  help,
  tour,
  children,
}: {
  n: number;
  title: string;
  help: string;
  tour?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-tour={tour} className="border-b border-rule py-4 first:pt-0 last:border-0">
      <h3 className="mb-2.5 flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-3">§{n}</span>
        <span className="font-serif text-[20px] leading-none text-ink">{title}</span>
        <Help text={help} />
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] italic text-ink-3">{children}</p>;
}

function FactList({ facts, timeline }: { facts: FactRef[]; timeline: TimelineResponse }) {
  const sources = sourceById(timeline);
  return (
    <ul className="space-y-2.5">
      {facts.map((r) => (
        <li key={`${r.fact_id}:${r.field}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-3 gap-y-0.5">
          <span className="text-[13.5px] text-ink">{r.label}</span>
          {r.field === "happened_at" || r.field === "stop_day" ? (
            <span className="tabular text-right text-[13px] text-ink">{day(r.value as number | null)}</span>
          ) : (
            <span className={cn("max-w-[24ch] text-right text-[13px] leading-snug", r.value === null ? "italic text-ink-3" : "text-ink")}>
              {r.value ?? "not known yet"}
            </span>
          )}
          <div className="col-span-2 flex items-baseline justify-between gap-3">
            <StateTag state={r.state} className="shrink-0" />
            <span className="min-w-0 truncate text-right text-[11px] text-ink-3">
              {r.source_ids.map((id) => stripSynthetic(sources.get(id)?.label ?? id)).join(", ")}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Investigation({
  inv,
  timeline,
  stale,
  suggestions,
  onSubmitEvidence,
  onReload,
}: {
  inv: InvestigationResponse;
  timeline: TimelineResponse;
  stale: boolean;
  suggestions?: string[];
  onSubmitEvidence: SubmitEvidence;
  onReload: () => void;
}) {
  const f = inv.finding;
  const ep = new Map(timeline.episodes.map((e) => [e.id, e]));
  const a = ep.get(f.index_episode_id);
  const b = ep.get(f.marker_episode_id);
  const o = timeline.observations.find((x) => f.observation_ids.includes(x.id));
  const gap = (from?: number | null, to?: number | null) =>
    from !== null && from !== undefined && to !== null && to !== undefined ? to - from : null;
  const span = gap(a?.happened_at, b?.happened_at);

  return (
    <div>
      {f.status === "needs_evidence" && (
        <InsufficientEvidenceState className="mb-4" missing={inv.unknowns.map((u) => u.label.toLowerCase())} />
      )}

      <Part n={1} title="On record" help="Facts from a document or the caregiver, each with its source.">
        {inv.documented.length ? <FactList facts={inv.documented} timeline={timeline} /> : <Empty>Nothing on record yet.</Empty>}
      </Part>

      <Part n={2} title="Why worth reviewing" help="The cited pattern this order of events fits, and the days between.">
        <p className="text-[13.5px] leading-relaxed text-ink">{inv.pattern.title}.</p>
        {a && b && o && (
          <ol className="relative mt-3 space-y-2 border-l border-rule-strong pl-4 text-[13px] text-ink-2">
            <li>
              <span className="text-ink">{a.ingredient.name}</span> started, {day(a.happened_at)}
            </li>
            <li>
              <span className="text-ink">{o.label.toLowerCase()}</span> began, {day(o.happened_at)}
              {gap(a.happened_at, o.happened_at) !== null && <span className="text-ink-3"> · {gap(a.happened_at, o.happened_at)} days later</span>}
            </li>
            <li>
              <span className="text-ink">{b.ingredient.name}</span> started, {day(b.happened_at)}
              {gap(o.happened_at, b.happened_at) !== null && <span className="text-ink-3"> · {gap(o.happened_at, b.happened_at)} days after that</span>}
            </li>
          </ol>
        )}
        {span !== null && (
          <p className="mt-3 text-[13px] text-ink-2">
            {span} days from the first medicine to the second,{" "}
            {span <= inv.pattern.window_days ? "inside" : "outside"} the pattern&rsquo;s {inv.pattern.window_days}-day window.
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {inv.pattern.evidence_refs.map((ref) => (
            <li key={ref.citation} className="flex gap-2 text-[12px] leading-snug text-ink-2">
              <BookOpen className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
              <span>
                {ref.citation}{" "}
                {ref.url && (
                  <a href={ref.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink">
                    doi:{ref.doi}
                  </a>
                )}
                {ref.note?.startsWith("TODO") && <span className="block text-[11px] italic text-ink-3">Citation details pending verification.</span>}
              </span>
            </li>
          ))}
        </ul>
      </Part>

      <Part n={3} title="Records disagree" help="Two records give different answers. Both are kept.">
        {inv.conflicts.length ? <FactList facts={inv.conflicts} timeline={timeline} /> : <Empty>No records disagree.</Empty>}
      </Part>

      <Part n={4} title="Not known yet" tour="unknowns" help="Facts the pattern needs that no record gives yet. Unknown never means “no”.">
        {inv.unknowns.length ? (
          <>
            <FactList facts={inv.unknowns} timeline={timeline} />
            <p className="mt-2 text-[12px] text-ink-3">
              &ldquo;Not available&rdquo; is recorded as an answer, never read as &ldquo;no&rdquo;.
            </p>
          </>
        ) : (
          <Empty>Nothing this pattern needs is missing.</Empty>
        )}
      </Part>

      <Part n={5} title="The one missing fact" help="The question that settles the most. Answer it as the caregiver would.">
        <NextQuestion
          key={`${inv.next_question?.id}:${inv.case_version}`}
          inv={inv}
          timeline={timeline}
          stale={stale}
          suggestions={suggestions}
          onSubmit={onSubmitEvidence}
          onReload={onReload}
        />
      </Part>

      <QueryTrace inv={inv} timeline={timeline} />
    </div>
  );
}

function QueryTrace({ inv, timeline }: { inv: InvestigationResponse; timeline: TimelineResponse }) {
  const tech = useTech();
  const tour = useTour();
  const name = (id: string) => {
    const label = factName(id, timeline);
    return label === id ? id.slice(id.indexOf(":") + 1) : label;
  };
  return (
    <details
      data-tour="query-trace"
      className="group mt-2 border-t border-ink pt-3"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) tour.emit("trace-opened");
      }}
    >
      <summary data-tour="query-trace-toggle" className="smallcaps flex cursor-pointer list-none items-center gap-1 text-ink-3 hover:text-ink">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        How the graph found this
      </summary>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
        FalkorDB keeps the medicines, symptoms, records and findings as one connected graph. Each step below is one
        walk through it, starting from this patient.
      </p>
      <ol className="mt-3 space-y-3.5">
        {inv.query_trace.map((q, i) => (
          <li key={`${q.query}:${i}`}>
            <p className="text-[13px] leading-snug text-ink">
              <span className="font-mono text-[11px] text-ink-3">{i + 1}.</span> {querySentence(q.query, q.result_ids)}
            </p>
            {tech && (
              <p className="mt-0.5 font-mono text-[11px] text-ink-2">
                {q.query}
                <span className="text-ink-3">
                  {" "}
                  · {q.rows} row{q.rows === 1 ? "" : "s"} · {q.mode}
                </span>
              </p>
            )}
            {!tech ? null : q.result_ids.length ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`IDs returned by ${q.query}`}>
                {q.result_ids.map((id) => (
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
            {tech && QUERIES[q.query] && (
              <details className="group/q mt-1.5">
                <summary className="flex cursor-pointer list-none items-center gap-1 font-mono text-[10.5px] text-ink-3 hover:text-ink">
                  <ChevronRight className="size-3 transition-transform group-open/q:rotate-90" aria-hidden />
                  <span className="truncate">cypher · {JSON.stringify(q.params)}</span>
                </summary>
                <pre className="mt-1.5 max-h-56 overflow-auto rounded-[4px] border border-rule bg-paper p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-2">
                  {QUERIES[q.query]}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      {!tech && (
        <p className="mt-3 text-[11.5px] text-ink-3">
          Turn on “Show technical details” to see each query&rsquo;s name, the IDs it returned and its Cypher.
        </p>
      )}
    </details>
  );
}

// ---------- Review history ----------

function History({
  inv,
  timeline,
  evidenceResults,
  onReview,
}: {
  inv: InvestigationResponse;
  timeline: TimelineResponse;
  evidenceResults: EvidenceResult[];
  onReview: Props["onReview"];
}) {
  const revisions = [...inv.revisions].sort((x, y) => y.n - x.n);
  const facts = new Map(
    [...timeline.episodes, ...timeline.observations].map((x) => [x.id, "label" in x ? x.label : x.ingredient.name]),
  );
  const resultFor = (rev: FindingRevision) => evidenceResults.find((r) => r.new_revisions.some((n) => n.id === rev.id));

  return (
    <div>
      <p className="mb-4 text-[12.5px] text-ink-3">
        Each change of evidence makes a new version of the finding. A clinician's decision stays attached to the version they saw.
      </p>
      <ol className="space-y-5">
        {revisions.map((rev) => {
          const decisions = inv.decisions.filter((d) => d.revision_n === rev.n);
          const result = resultFor(rev);
          const current = rev.n === inv.finding.revision_n;
          return (
            <motion.li
              key={rev.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative border-l border-ink pl-4"
            >
              <span className={cn("absolute -left-[5px] top-1.5 size-[9px] rounded-full border border-ink", current ? "bg-ink" : "bg-ivory")} aria-hidden />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h4 className="font-serif text-[20px] leading-none text-ink">Revision {rev.n}</h4>
                <StatusChip status={rev.status} />
                <span className="font-mono text-[11px] text-ink-3">{day(rev.created_at)}</span>
                {current && <span className="smallcaps text-[10px] text-ink-3">current</span>}
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{rev.reason}</p>
              {rev.changed_fact_ids.length > 0 && (
                <p className="mt-1 text-[12px] text-ink-3">
                  Changed: {rev.changed_fact_ids.map((id) => facts.get(id) ?? id).join(", ")}
                </p>
              )}
              {result && <BeforeAfter result={result} />}
              {decisions.map((d) => (
                <div
                  key={d.id}
                  data-tour={current ? undefined : "kept-decision"}
                  className="mt-3 rounded-[4px] border border-teal/60 border-l-[3px] border-l-teal bg-teal-wash/50 px-3 py-2"
                >
                  <p className="smallcaps text-[10px] text-teal-ink">
                    {d.by_role} · {DECISION_LABEL[d.decision]} · {day(d.decided_at)}
                    {!current && " · kept on the version they saw"}
                  </p>
                  <p className="mt-1 font-serif text-[16px] leading-snug text-ink">&ldquo;{d.reason}&rdquo;</p>
                </div>
              ))}
            </motion.li>
          );
        })}
      </ol>
      <ReviewForm inv={inv} onReview={onReview} />
    </div>
  );
}

function ReviewForm({ inv, onReview }: { inv: InvestigationResponse; onReview: Props["onReview"] }) {
  const [role, setRole] = useState<ReviewerRole>("pharmacist");
  const [decision, setDecision] = useState<ReviewChoice>("follow_up");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const n = inv.finding.revision_n;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    setDone(false);
    const ok = await onReview(inv.finding.id, {
      case_version: inv.case_version,
      revision_n: n,
      by_role: role,
      decision,
      reason: reason.trim(),
    });
    setBusy(false);
    if (ok) {
      setReason("");
      setDone(true);
    }
  }

  const radio = "peer sr-only";
  const pill =
    "cursor-pointer rounded-full border border-rule-strong px-3 py-1 text-[12.5px] text-ink-2 transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-ivory peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ink";

  return (
    <form onSubmit={submit} className="mt-6 border-t border-ink pt-4">
      <h4 className="font-serif text-[20px] text-ink">Record a decision</h4>
      <p className="mt-0.5 text-[12px] text-ink-3">Attached to revision {n}. The clinician decides; this records it.</p>
      <fieldset className="mt-3">
        <legend className="smallcaps mb-1.5 text-ink-3">Role</legend>
        <div className="flex flex-wrap gap-2">
          {(["pharmacist", "clinician"] as ReviewerRole[]).map((r) => (
            <label key={r}>
              <input type="radio" name="role" className={radio} checked={role === r} onChange={() => setRole(r)} />
              <span className={pill}>{r[0].toUpperCase() + r.slice(1)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-3">
        <legend className="smallcaps mb-1.5 text-ink-3">Decision</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(DECISION_LABEL) as ReviewChoice[]).map((d) => (
            <label key={d}>
              <input type="radio" name="decision" className={radio} checked={decision === d} onChange={() => setDecision(d)} />
              <span className={pill}>{DECISION_LABEL[d]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-3 block">
        <span className="smallcaps mb-1.5 block text-ink-3">Reason</span>
        <textarea
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="What was decided, and why."
          className="w-full resize-y rounded-[4px] border border-rule-strong bg-paper px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none"
        />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || !reason.trim()}>
          {busy ? "Recording…" : `Record on revision ${n}`}
        </Button>
        <AnimatePresence>
          {done && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[12px] text-teal-ink">
              Decision recorded.
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
