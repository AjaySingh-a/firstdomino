"use client";

import { ArrowLeft, Check, Link2, Printer } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DECISION_LABEL, STATUS, day, sourceById, stripSynthetic } from "@/lib/present";
import { Tech } from "@/lib/tech";
import type { AgentStep, FactRef, PacketItem, PacketResponse, TimelineResponse } from "@/lib/types";
import { describeError, type Loadable } from "@/lib/use-workspace";
import { cn } from "@/lib/utils";
import { FactStates } from "./fact-states";
import { Wordmark } from "./site-header";
import { LoadingState, UnavailableState } from "./state-notice";
import { StateTag, StatusChip } from "./status";
import { Button } from "./ui/button";

type Data = { packet: PacketResponse; timeline: TimelineResponse; steps: AgentStep[] };

/** GET /patients/{id}/packet, printable: timeline, unresolved questions, cited observations, and the next
 * conversation to have with the clinician. */
export function Packet({ pid }: { pid: string }) {
  const [state, setState] = useState<Loadable<Data>>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    Promise.all([api.packet(pid), api.timeline(pid), api.agentSteps(pid).then((r) => r.steps, () => [])]).then(
      ([packet, timeline, steps]) => setState({ kind: "ready", data: { packet, timeline, steps } }),
      (err) => setState({ kind: "unavailable", message: describeError(err) }),
    );
  }, [pid]);
  useEffect(load, [load]);

  return (
    <div className="packet mx-auto min-h-dvh max-w-4xl px-4 pb-16 sm:px-8 print:max-w-none print:px-0 print:pb-0">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink py-4 print:py-2">
        <Wordmark />
        <Toolbar pid={pid} />
      </header>

      {state.kind === "loading" && <LoadingState className="mt-8" label="Assembling the packet" lines={6} />}
      {state.kind === "unavailable" && <UnavailableState className="mt-8" message={state.message} onRetry={load} />}
      {state.kind === "ready" && <Body {...state.data} />}
    </div>
  );
}

function Toolbar({ pid }: { pid: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "FirstDomino review packet (synthetic)", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // share sheet closed, or clipboard blocked: nothing to do
    }
  }
  return (
    <nav className="flex flex-wrap items-center gap-2 print:hidden" aria-label="Packet actions">
      <Link
        href={`/patients/${encodeURIComponent(pid)}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-[13px] text-ink-2 hover:bg-paper hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Workspace
      </Link>
      <Button size="sm" variant="outline" onClick={share}>
        {copied ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
        {copied ? "Link copied" : "Share link"}
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="size-3.5" aria-hidden /> Print
      </Button>
    </nav>
  );
}

function Body({ packet, timeline, steps }: Data) {
  const p = packet.patient;
  const questions = packet.items.flatMap((i) => i.open_questions);
  const unknowns = packet.items.flatMap((i) => i.unknowns);
  return (
    <main>
      <section className="py-6 print:py-3">
        <p className="smallcaps text-ink-3">Medication review packet · synthetic patient</p>
        <h1 className="mt-1 font-serif text-[40px] leading-none sm:text-[52px] print:text-[34px]">{p.label}</h1>
        <dl className="tabular mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11.5px] text-ink-2">
          <Tech><div className="flex gap-1.5"><dt className="text-ink-3">patient</dt><dd>{p.id}</dd></div></Tech>
          <div className="flex gap-1.5"><dt className="text-ink-3">age</dt><dd>{p.age_band}</dd></div>
          <div className="flex gap-1.5"><dt className="text-ink-3">as of</dt><dd>day {p.as_of_day}</dd></div>
          <Tech><div className="flex gap-1.5"><dt className="text-ink-3">case</dt><dd>v{packet.case_version}</dd></div></Tech>
        </dl>
        <p className="mt-4 rounded-[4px] border border-l-[3px] border-rule-strong border-l-ink bg-paper px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          {packet.disclaimer}
        </p>
      </section>

      <Section n={1} title="Timeline">
        <Timeline timeline={timeline} />
      </Section>

      <Section n={2} title="Unresolved questions">
        {questions.length ? (
          <ol className="space-y-2.5">
            {questions.map((q) => (
              <li key={q.id} className="break-inside-avoid">
                <p className="smallcaps text-[10px] text-ink-3">
                  For the {q.ask_role} · {q.asked_at === null ? "not asked yet" : `asked ${day(q.asked_at)}`}
                </p>
                <p className="mt-0.5 font-serif text-[17px] leading-snug text-ink">&ldquo;{q.text}&rdquo;</p>
                <FactStates
                  className="max-w-md"
                  refs={unknowns.filter((u, i, all) => u.requirement_id === q.requirement_id && all.indexOf(u) === i)}
                />
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No open questions. Everything the patterns need is documented, reported or marked not available.</Empty>
        )}
      </Section>

      {packet.items.map((item, i) => (
        <FindingSection key={item.finding.id} n={3 + i} item={item} timeline={timeline} steps={steps} />
      ))}
      {packet.items.length === 0 && (
        <Section n={3} title="Possible patterns">
          <Empty>No possible pattern matched for this patient.</Empty>
        </Section>
      )}

      <footer className="mt-8 border-t border-rule pt-3 text-[11px] text-ink-3">
        FirstDomino · synthetic data · possible patterns for a clinician to review, never conclusions. Medicine changes
        are the prescribing clinician&rsquo;s decision.
      </footer>
    </main>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-ink py-5 print:py-3">
      <h2 className="mb-3 flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-ink-3">§{n}</span>
        <span className="font-serif text-[24px] leading-none text-ink print:text-[20px]">{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] italic text-ink-3">{children}</p>;
}

// ---------- timeline: one lane per medicine, observations as marks, like the Medication River ----------

function Timeline({ timeline }: { timeline: TimelineResponse }) {
  const end = Math.max(
    timeline.patient.as_of_day,
    ...timeline.episodes.map((e) => e.stop_day ?? e.happened_at ?? 0),
    ...timeline.observations.map((o) => o.happened_at ?? 0),
    1,
  );
  const W = 720;
  const L = 128; // label column
  const lane = 30;
  const x = (d: number) => L + ((W - L - 16) * d) / end;
  const lanes = [...timeline.episodes].sort((a, b) => (a.happened_at ?? 0) - (b.happened_at ?? 0));
  const obsY = lanes.length * lane + 22;
  const H = obsY + 40;
  const step = end <= 60 ? 10 : end <= 150 ? 20 : 50;
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);

  return (
    <figure className="break-inside-avoid">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Medication timeline by day">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={4} y2={H - 18} stroke="var(--rule)" strokeWidth={1} />
            <text x={x(t)} y={H - 4} textAnchor="middle" className="fill-[var(--ink-3)] font-mono text-[10px]">
              d{t}
            </text>
          </g>
        ))}
        {lanes.map((e, i) => {
          const y = i * lane + 18;
          const start = e.happened_at;
          const stop = e.stop_day ?? timeline.patient.as_of_day;
          return (
            <g key={e.id}>
              <text x={0} y={y + 4} className="fill-[var(--ink)] text-[12px]">
                {e.ingredient.name}
              </text>
              {start === null ? (
                <text x={L} y={y + 4} className="fill-[var(--ink-3)] text-[11px] italic">
                  start day not known yet
                </text>
              ) : (
                <>
                  <line
                    x1={x(start)}
                    x2={x(stop)}
                    y1={y}
                    y2={y}
                    stroke="var(--ink)"
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={e.state === "documented" ? undefined : "8 5"}
                  />
                  <text x={x(start)} y={y - 7} className="fill-[var(--ink-3)] font-mono text-[9.5px]">
                    d{start}
                  </text>
                </>
              )}
            </g>
          );
        })}
        <text x={0} y={obsY + 4} className="fill-[var(--ink)] text-[12px]">
          observations
        </text>
        {timeline.observations.map((o) =>
          o.happened_at === null ? null : (
            <g key={o.id}>
              <circle
                cx={x(o.happened_at)}
                cy={obsY}
                r={5}
                fill={o.state === "documented" ? "var(--amber)" : "var(--paper)"}
                stroke="var(--amber-ink)"
                strokeWidth={1.5}
              />
              <text x={x(o.happened_at) + 9} y={obsY + 4} className="fill-[var(--ink-2)] text-[11px]">
                {o.label.toLowerCase()} · d{o.happened_at}
              </text>
            </g>
          ),
        )}
      </svg>
      <figcaption className="mt-1 text-[11px] text-ink-3">
        Solid bar: start day documented. Dashed: reported or not settled. Filled mark: documented onset; hollow: reported.
      </figcaption>
    </figure>
  );
}

// ---------- one finding ----------

function FindingSection({ n, item, timeline, steps }: { n: number; item: PacketItem; timeline: TimelineResponse; steps: AgentStep[] }) {
  const f = item.finding;
  const sources = sourceById(timeline);
  const observations = timeline.observations.filter((o) => f.observation_ids.includes(o.id));
  const drafted = [...steps]
    .reverse()
    .find((s) => s.finding_id === f.id && s.ok && s.args.agent_tool === "prepare_packet" && typeof s.args.text === "string");
  const srcLabel = (ids: string[]) => ids.map((id) => stripSynthetic(sources.get(id)?.label ?? id)).join(", ");

  return (
    <Section n={n} title={f.headline}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={f.status} />
        <span className="text-[11.5px] text-ink-3">version {f.revision_n}</span>
        <Tech>
          <span className="font-mono text-[11px] text-ink-3">
            {f.status} · rev {f.revision_n} · pattern v{f.pattern_version}
          </span>
        </Tech>
      </div>
      <p className="mt-1.5 text-[13px] text-ink-2">{STATUS[f.status].blurb}</p>

      <div className="mt-4 grid gap-5 md:grid-cols-2 print:grid-cols-2">
        <div className="min-w-0 break-inside-avoid">
          <h3 className="smallcaps mb-2 text-ink-3">Cited observations</h3>
          {observations.length ? (
            <ul className="space-y-2">
              {observations.map((o) => (
                <li key={o.id}>
                  <p className="flex items-baseline justify-between gap-3 text-[13.5px] text-ink">
                    {o.label} <span className="tabular text-[13px]">{day(o.happened_at)}</span>
                  </p>
                  <div className="flex items-baseline justify-between gap-3">
                    <StateTag state={o.state} />
                    <span className="truncate text-[11px] text-ink-3">{srcLabel(o.source_ids)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No observation cited.</Empty>
          )}
        </div>
        <div className="min-w-0 break-inside-avoid">
          <h3 className="smallcaps mb-2 text-ink-3">Facts the pattern depends on</h3>
          <Refs refs={[...item.documented, ...item.conflicts, ...item.unknowns]} srcLabel={srcLabel} />
        </div>
      </div>

      {item.decisions.length > 0 && (
        <div className="mt-4 break-inside-avoid">
          <h3 className="smallcaps mb-2 text-ink-3">Recorded decisions</h3>
          <ul className="space-y-2">
            {item.decisions.map((d) => (
              <li key={d.id} className="border-l-[3px] border-teal pl-3">
                <p className="smallcaps text-[10px] text-teal">
                  {d.by_role} · {DECISION_LABEL[d.decision]} · revision {d.revision_n} · {day(d.decided_at)}
                  {d.revision_n !== f.revision_n && " · kept on that revision"}
                </p>
                <p className="font-serif text-[15px] leading-snug text-ink">&ldquo;{d.reason}&rdquo;</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 break-inside-avoid rounded-[6px] border border-ink bg-paper px-4 py-3 print:bg-transparent">
        <h3 className="font-serif text-[19px] leading-tight text-ink">The next conversation to have with the clinician</h3>
        {drafted ? (
          <>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{drafted.args.text as string}</p>
            <FactStates refs={[...item.documented, ...item.conflicts, ...item.unknowns]} />
            <p className="mt-1.5 text-[11px] text-ink-3">
              Drafted by the review agent ({String(drafted.args.phrasing ?? "template")}) from the evidence IDs above,
              {" "}{day(drafted.at)}.
            </p>
          </>
        ) : (
          <NextConversation item={item} />
        )}
      </div>
    </Section>
  );
}

function Refs({ refs, srcLabel }: { refs: FactRef[]; srcLabel: (ids: string[]) => string }) {
  return (
    <ul className="space-y-2">
      {refs.map((r) => (
        <li key={`${r.fact_id}:${r.field}`}>
          <p className="flex items-baseline justify-between gap-3 text-[13.5px] text-ink">
            <span>{r.label}</span>
            <span className={cn("max-w-[22ch] text-right text-[13px]", r.value === null && "italic text-ink-3")}>
              {r.field === "happened_at" ? day(r.value as number | null) : (r.value ?? "not known yet")}
            </span>
          </p>
          <div className="flex items-baseline justify-between gap-3">
            <StateTag state={r.state} />
            <span className="truncate text-[11px] text-ink-3">{srcLabel(r.source_ids)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Shown before the review agent has drafted anything: only what the packet already holds. */
function NextConversation({ item }: { item: PacketItem }) {
  const points = [
    ...item.conflicts.map((r) => `The records disagree on ${r.label.toLowerCase()}. Which record is right?`),
    ...item.unknowns.map((r) => `${r.label} is not known yet.`),
    ...item.open_questions.map((q) => `Open question for the ${q.ask_role}: ${q.text}`),
  ];
  if (item.finding.status === "needs_reassessment") points.push("The evidence changed after the last review: worth a fresh look.");
  return (
    <>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-ink">
        {points.length ? points.map((p) => <li key={p}>{p}</li>) : <li>Confirm the documented timeline above and whether this possible pattern is worth acting on.</li>}
        <li>Any change to a medicine is the prescribing clinician&rsquo;s decision.</li>
      </ul>
      <p className="mt-1.5 text-[11px] text-ink-3 print:hidden">
        Run the review agent from the workspace drawer to draft this as text.
      </p>
    </>
  );
}
