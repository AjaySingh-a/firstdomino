"use client";

// Three landing bands below the fold: the proof numbers (count up once, when seen), what the graph
// remembers when a record changes (story 3, as a short loop), and the two hackathon tracks.
// Under reduced motion each one is a still picture of its end state.

import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Accent, Reveal, SectionHead } from "./reveal";

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
    if (reduced || to === 0) return setV(to);
    if (!run) return setV(0);
    const c = animate(0, to, {
      duration: 1.1,
      ease: "easeOut",
      onUpdate: (x) => setV(Math.round(x)),
    });
    return () => c.stop();
  }, [run, to, reduced]);
  return <>{v}</>;
}

export function ProofStrip() {
  const ref = useRef<HTMLOListElement>(null);
  // Counts up each time the strip comes into view, scrolling down or back up.
  const seen = useInView(ref, { amount: 0.4 });
  return (
    <section aria-labelledby="proof-h" className="border-t border-ink bg-paper py-20 sm:py-28">
      <div className="wrap">
        <SectionHead
          n="03"
          kicker="Proof"
          title={
            <span id="proof-h">
              Checked, <Accent>not claimed</Accent>.
            </span>
          }
          note="Run on the graph engine. Agreement with our documented rules, not clinical validation."
        />
        <ol ref={ref} className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
          {PROOF.map((p, i) => (
            <Reveal as="li" key={p.label} delay={i * 0.08} className="border-t-2 border-ink pt-5">
              <p className="tabular font-display text-[clamp(48px,6vw,84px)] font-extrabold leading-none tracking-[-0.04em] text-ink">
                <CountUp to={p.n} run={seen} />
                {p.of !== undefined && <span className="text-amber-ink">/{p.of}</span>}
              </p>
              <p className="mt-3 max-w-[24ch] text-[14.5px] leading-snug text-ink-2">{p.label}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------- what the graph remembers ----------

const CYCLE = 6; // seconds

/** One version box. `at` is when in the loop it appears (0..1); `fade` when it is superseded. */
function Box({
  title,
  sub,
  tone,
  at = 0,
  fade,
  reduced,
}: {
  title: string;
  sub: string;
  tone: "ink" | "amber" | "teal" | "old";
  at?: number;
  fade?: number;
  reduced: boolean;
}) {
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
      <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{title}</p>
    </motion.div>
  );
}

function Arrow({ at, reduced }: { at: number; reduced: boolean }) {
  const anim = reduced
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: [0, 0, 1, 1, 0] },
        transition: {
          duration: CYCLE,
          repeat: Infinity,
          times: [0, at, at + 0.08, 0.92, 1],
        },
      };
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
    {
      label: "Fact",
      old: { title: "swelling began day 28", sub: "v1 · letter" },
      now: { title: "swelling began day 14", sub: "v2 · late GP note" },
      at: 0.15,
      tone: "ink" as const,
    },
    {
      label: "Finding",
      old: { title: "Reviewed", sub: "revision 1" },
      now: { title: "Needs a fresh look", sub: "revision 2" },
      at: 0.4,
      tone: "amber" as const,
    },
  ];
  return (
    <section aria-labelledby="mem-h" className="border-t border-ink py-20 sm:py-28">
      <div className="wrap">
        <SectionHead
          n="04"
          kicker="Memory"
          title={
            <span id="mem-h">
              Nothing is <Accent>overwritten</Accent>.
            </span>
          }
          note="Story 3: a late note changes a date. Watch what the graph keeps."
        />
        <Reveal delay={0.1}>
          <div
            ref={ref}
            role="img"
            aria-label="The fact moves from version 1 to version 2, the finding from revision 1 to revision 2, and the clinician's decision stays attached to revision 1."
            className="mt-12 grid gap-4 rounded-[16px] border border-ink bg-paper p-5 shadow-[8px_8px_0_var(--ink)] sm:p-8"
          >
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[1fr_16px_1fr] items-center gap-x-2 gap-y-1 sm:grid-cols-[110px_1fr_40px_1fr]">
                <span className="smallcaps col-span-3 text-ink-3 sm:col-span-1">{r.label}</span>
                <Box {...r.old} tone="old" fade={r.at} reduced={reduced} />
                <Arrow at={r.at} reduced={reduced} />
                <Box {...r.now} tone={r.tone} at={r.at} reduced={reduced} />
              </div>
            ))}
            <div className="grid grid-cols-[1fr_16px_1fr] items-center gap-x-2 gap-y-1 sm:grid-cols-[110px_1fr_40px_1fr]">
              <span className="smallcaps col-span-3 text-ink-3 sm:col-span-1">Decision</span>
              <Box title="Kept on revision 1" sub="clinician review" tone="teal" reduced={reduced} />
              <span aria-hidden />
              <p className="text-[14px] font-semibold leading-snug text-ink">Attached to what they actually saw.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---------- tracks ----------

const TRACKS = [
  {
    name: "Agents That Act on Connected Data",
    how: (
      <>
        The review agent <b>walks the patient graph</b> with allowlisted tools and records the next question.
      </>
    ),
  },
  {
    name: "Agent Memory and Coordination",
    how: (
      <>
        Facts, findings, agent steps and decisions are <b>versioned in FalkorDB</b> and survive restarts.
      </>
    ),
  },
];

export function Tracks() {
  return (
    <section aria-labelledby="tracks-h" className="border-t border-ink bg-paper py-20 sm:py-24">
      <div className="wrap">
        <SectionHead
          n="06"
          kicker="Graph Hacks 2026"
          title={
            <span id="tracks-h">
              Two tracks, <Accent>one graph</Accent>.
            </span>
          }
        />
        <ul className="mt-12 grid gap-5 md:grid-cols-2">
          {TRACKS.map((t, i) => (
            <Reveal as="li" key={t.name} delay={i * 0.12} className="rounded-[12px] border border-ink bg-ivory p-6">
              <span className="inline-flex rounded-full border border-ink bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-ivory">
                {t.name}
              </span>
              <p className="mt-4 text-[16px] leading-snug text-ink-2">{t.how}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
