"use client";

// Three landing bands below the fold: the proof numbers (count up once, when seen), what the graph
// remembers when a record changes (story 3, as a short loop), and the two hackathon tracks.
// Under reduced motion each one is a still picture of its end state.

import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// From bench/results.md and the README's restart and runner checks.
const PROOF = [
  { n: 12, of: 12, label: "synthetic cases agree with the documented rules" },
  { n: 98, of: 98, label: "checks agree, case by case" },
  { n: 5, of: 5, label: "deliberately wrong expectations caught" },
  { n: 0, label: "facts lost after restarting FalkorDB and the API" },
];

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [v, setV] = useState(to);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || !run || to === 0) return setV(to);
    const c = animate(0, to, { duration: 1.1, ease: "easeOut", onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [run, to, reduced]);
  return <>{v}</>;
}

export function ProofStrip() {
  const ref = useRef<HTMLOListElement>(null);
  const seen = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section aria-labelledby="proof-h" className="border-t border-ink py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="proof-h" className="font-serif text-[30px]">Checked, not claimed</h2>
        <p className="text-[13px] text-ink-3">Run on the graph engine. Not clinical validation.</p>
      </div>
      <ol ref={ref} className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-ink bg-ink md:grid-cols-4">
        {PROOF.map((p) => (
          <li key={p.label} className="bg-ivory p-5">
            <p className="tabular font-serif text-[40px] leading-none text-amber-ink">
              <CountUp to={p.n} run={seen} />
              {p.of !== undefined && <span className="text-ink-3">/{p.of}</span>}
            </p>
            <p className="mt-2 text-[13px] leading-snug text-ink-2">{p.label}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- what the graph remembers ----------

const CYCLE = 6; // seconds

/** One version box. `at` is when in the loop it appears (0..1); `fade` when it is superseded. */
function Box({ title, sub, tone, at = 0, fade, reduced }: { title: string; sub: string; tone: "ink" | "amber" | "teal" | "old"; at?: number; fade?: number; reduced: boolean }) {
  const toneCls = {
    ink: "border-ink bg-paper",
    amber: "border-amber-ink bg-amber-wash",
    teal: "border-teal bg-teal-wash",
    old: "border-rule-strong bg-paper",
  }[tone];
  const anim = reduced
    ? {}
    : {
        initial: { opacity: at > 0 ? 0 : 1 },
        animate: {
          opacity: fade !== undefined ? [1, 1, 0.45, 0.45, 1] : at > 0 ? [0, 0, 1, 1, 0] : 1,
        },
        transition: {
          duration: CYCLE,
          repeat: Infinity,
          times: fade !== undefined ? [0, fade, fade + 0.08, 0.92, 1] : [0, at, at + 0.08, 0.92, 1],
        },
      };
  return (
    <motion.div {...anim} className={cn("min-w-0 rounded-[6px] border px-3 py-2", toneCls)}>
      <p className="font-mono text-[10.5px] text-ink-3">{sub}</p>
      <p className="mt-0.5 text-[13.5px] leading-snug text-ink">{title}</p>
    </motion.div>
  );
}

function Arrow({ at, reduced }: { at: number; reduced: boolean }) {
  const anim = reduced ? {} : { initial: { opacity: 0 }, animate: { opacity: [0, 0, 1, 1, 0] }, transition: { duration: CYCLE, repeat: Infinity, times: [0, at, at + 0.08, 0.92, 1] } };
  return (
    <motion.span {...anim} aria-hidden className="text-center font-mono text-[14px] text-ink-3">
      →
    </motion.span>
  );
}

export function GraphMemory() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { margin: "-60px" });
  const prefersReduced = useReducedMotion();
  // Still until it is on screen; the still picture is the loop's end state.
  const reduced = !!prefersReduced || !seen;
  const rows = [
    { label: "Fact", old: { title: "swelling began day 28", sub: "v1 · letter" }, now: { title: "swelling began day 14", sub: "v2 · late GP note" }, at: 0.15, tone: "ink" as const },
    { label: "Finding", old: { title: "Reviewed", sub: "revision 1" }, now: { title: "Needs a fresh look", sub: "revision 2" }, at: 0.4, tone: "amber" as const },
  ];
  return (
    <section aria-labelledby="mem-h" className="border-t border-ink py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mem-h" className="font-serif text-[30px]">What the graph remembers</h2>
        <p className="text-[13px] text-ink-3">Story 3: a late note changes a date.</p>
      </div>
      <div
        ref={ref}
        role="img"
        aria-label="The fact moves from version 1 to version 2, the finding from revision 1 to revision 2, and the clinician's decision stays attached to revision 1."
        className="mt-5 grid gap-3 rounded-[8px] border border-ink bg-ivory p-4 sm:p-5"
      >
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[1fr_16px_1fr] items-center gap-x-2 gap-y-1 sm:grid-cols-[90px_1fr_28px_1fr]">
            <span className="smallcaps col-span-3 text-ink-3 sm:col-span-1">{r.label}</span>
            <Box {...r.old} tone="old" fade={r.at} reduced={reduced} />
            <Arrow at={r.at} reduced={reduced} />
            <Box {...r.now} tone={r.tone} at={r.at} reduced={reduced} />
          </div>
        ))}
        <div className="grid grid-cols-[1fr_16px_1fr] items-center gap-x-2 gap-y-1 sm:grid-cols-[90px_1fr_28px_1fr]">
          <span className="smallcaps col-span-3 text-ink-3 sm:col-span-1">Decision</span>
          <Box title="Kept on revision 1" sub="clinician review" tone="teal" reduced={reduced} />
          <span aria-hidden />
          <p className="text-[12.5px] leading-snug text-ink-2">Attached to what they actually saw.</p>
        </div>
      </div>
    </section>
  );
}

// ---------- tracks ----------

const TRACKS = [
  { name: "Agents That Act on Connected Data", how: "The review agent walks the patient graph with allowlisted tools and records the next question." },
  { name: "Agent Memory and Coordination", how: "Facts, findings, agent steps and decisions are versioned in FalkorDB and survive restarts." },
];

export function Tracks() {
  return (
    <section aria-labelledby="tracks-h" className="border-t border-ink py-10">
      <h2 id="tracks-h" className="font-serif text-[30px]">Graph Hacks tracks</h2>
      <ul className="mt-5 grid gap-3 md:grid-cols-2">
        {TRACKS.map((t) => (
          <li key={t.name} className="rounded-[8px] border border-ink bg-paper p-4">
            <span className="inline-flex rounded-full border border-ink bg-ink px-3 py-1 text-[12px] font-medium text-ivory">{t.name}</span>
            <p className="mt-2.5 text-[14px] leading-snug text-ink-2">{t.how}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
