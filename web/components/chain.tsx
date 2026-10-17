"use client";

// The landing animation: a pill, then a side effect, then a second pill, joined by a chain that glows
// amber once it is complete. Loops gently; a still picture under reduced motion.

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const CYCLE = 7; // seconds

function Pill({ x, y, tone }: { x: number; y: number; tone: "first" | "second" }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(-28)`}>
      <rect x={-26} y={-11} width={52} height={22} rx={11} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.5} />
      <path d="M0 -11 H15 A11 11 0 0 1 15 11 H0 Z" fill={tone === "first" ? "var(--amber)" : "var(--teal-wash)"} stroke="var(--ink)" strokeWidth={1.5} />
    </g>
  );
}

function Swelling({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-13} y={-13} width={26} height={26} transform="rotate(45)" fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.5} />
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${-28 - i * 6} ${-6 + i * 6} q4 -4 8 0 t8 0`} fill="none" stroke="var(--ink-3)" strokeWidth={1.2} strokeLinecap="round" />
      ))}
    </g>
  );
}

const LINKS = ["M96 150 Q96 80 200 80", "M232 80 Q340 80 340 150"];

export function ChainAnimation({ className }: { className?: string }) {
  // The server cannot know the visitor's motion setting: render the still picture first, then start
  // the loop after mounting unless reduced motion is on.
  const prefersReduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reduced = !mounted || !!prefersReduced;
  const loop = (times: number[], values: number[]) =>
    reduced
      ? { initial: { opacity: Math.max(...values) }, animate: undefined }
      : {
          initial: { opacity: values[0] },
          animate: { opacity: values },
          transition: { duration: CYCLE, times, repeat: Infinity, ease: "easeInOut" as const },
        };
  const draw = (start: number) =>
    reduced
      ? { initial: { pathLength: 1 } }
      : {
          initial: { pathLength: 0 },
          animate: { pathLength: [0, 0, 1, 1, 0] },
          transition: { duration: CYCLE, times: [0, start, start + 0.12, 0.9, 1], repeat: Infinity, ease: "easeInOut" as const },
        };

  return (
    <figure className={className}>
      <svg key={reduced ? "still" : "moving"} viewBox="0 0 440 230" role="img" aria-label="A first medicine, then a side effect, then a second medicine for that side effect, joined as a chain" className="w-full">
        {/* the glow behind the finished chain */}
        {LINKS.map((d, i) => (
          <motion.path key={`g${i}`} d={d} fill="none" stroke="var(--amber)" strokeWidth={14} strokeLinecap="round" {...loop([0, 0.55, 0.62, 0.85, 0.92, 1], [0, 0, 0.3, 0.3, 0, 0])} />
        ))}
        <motion.path d={LINKS[0]} fill="none" stroke="var(--amber)" strokeWidth={2.5} strokeLinecap="round" {...draw(0.2)} />
        {/* not known yet: dashed, so it fades in rather than drawing (drawing would replace the dashes) */}
        <motion.path d={LINKS[1]} fill="none" stroke="var(--amber)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="7 6" {...loop([0, 0.42, 0.52, 0.9, 0.96, 1], [0, 0, 1, 1, 0, 0])} />

        <motion.g {...loop([0, 0.04, 0.1, 0.9, 0.96, 1], [0, 0, 1, 1, 0, 0])}>
          <Pill x={96} y={168} tone="first" />
          <text x={96} y={210} textAnchor="middle" className="fill-[var(--ink)] font-serif text-[17px]">amlodipine</text>
          <text x={96} y={226} textAnchor="middle" className="fill-[var(--ink-3)] text-[11px]">day 0 · blood pressure</text>
        </motion.g>
        <motion.g {...loop([0, 0.26, 0.32, 0.9, 0.96, 1], [0, 0, 1, 1, 0, 0])}>
          <Swelling x={216} y={80} />
          <text x={216} y={36} textAnchor="middle" className="fill-[var(--ink)] font-serif text-[17px]">ankle swelling</text>
          <text x={216} y={52} textAnchor="middle" className="fill-[var(--ink-3)] text-[11px]">day 21 · a possible side effect</text>
        </motion.g>
        <motion.g {...loop([0, 0.48, 0.54, 0.9, 0.96, 1], [0, 0, 1, 1, 0, 0])}>
          <Pill x={340} y={168} tone="second" />
          <text x={340} y={210} textAnchor="middle" className="fill-[var(--ink)] font-serif text-[17px]">furosemide</text>
          <text x={340} y={226} textAnchor="middle" className="fill-[var(--ink-3)] text-[11px]">day 35 · reason not recorded</text>
        </motion.g>
        <motion.text x={340} y={118} textAnchor="middle" className="fill-[var(--amber-ink)] text-[12px] font-medium" {...loop([0, 0.6, 0.66, 0.88, 0.94, 1], [0, 0, 1, 1, 0, 0])}>
          why was it started?
        </motion.text>
      </svg>
      <figcaption className="sr-only">
        Amlodipine is started on day 0. Ankle swelling begins on day 21. Furosemide is started on day 35, and why is not recorded.
      </figcaption>
    </figure>
  );
}

/** The three-step strip: a medicine, a side effect, a second medicine. */
export function HowItWorksStrip() {
  const steps = [
    {
      n: 1,
      title: "A medicine is started",
      text: "For example amlodipine, for blood pressure.",
      art: (
        <svg viewBox="0 0 80 56" className="h-14 w-20" aria-hidden>
          <Pill x={40} y={28} tone="first" />
        </svg>
      ),
    },
    {
      n: 2,
      title: "A side effect appears",
      text: "Weeks later the ankles swell, a known side effect.",
      art: (
        <svg viewBox="0 0 80 56" className="h-14 w-20" aria-hidden>
          <Swelling x={50} y={28} />
        </svg>
      ),
    },
    {
      n: 3,
      title: "A second medicine treats it",
      text: "A water tablet is started for the swelling, maybe without anyone linking the two.",
      art: (
        <svg viewBox="0 0 80 56" className="h-14 w-20" aria-hidden>
          <Pill x={40} y={28} tone="second" />
        </svg>
      ),
    },
  ];
  return (
    <div>
      <ol className="grid gap-px overflow-hidden rounded-[8px] border border-ink bg-ink sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-3 bg-paper p-4">
            {s.art}
            <div>
              <p className="font-mono text-[11px] text-amber-ink">{s.n}</p>
              <p className="font-serif text-[20px] leading-tight">{s.title}</p>
              <p className="mt-1 text-[13px] leading-snug text-ink-2">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 flex items-center gap-2 text-[15px] text-ink">
        <span aria-hidden className="h-0.5 w-6 rounded-full bg-amber" />
        FirstDomino flags the chain and asks what&rsquo;s missing.
      </p>
    </div>
  );
}
