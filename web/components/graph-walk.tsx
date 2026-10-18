"use client";

// The walk Q1 takes through FalkorDB for one finding, drawn edge by edge in the order the query follows
// it: patient -> first medicine -> its class <- pattern -> effect <- symptom, and pattern -> second class
// <- second medicine. A fact that is not known yet is dashed. Still picture under reduced motion.

import { motion, useReducedMotion } from "framer-motion";
import { StatusChip } from "@/components/status";
import type { FactState, FindingStatus } from "@/lib/types";

export interface WalkFact {
  label: string;
  sub: string;
  state: FactState | "missing";
}

export interface WalkProps {
  pid: string;
  first: WalkFact;
  firstClass: string;
  symptom: WalkFact;
  effect: string;
  second: WalkFact;
  secondClass: string;
  status: FindingStatus;
  delay?: number;
}

const X = { patient: 62, fact: 228, kb: 422, pattern: 604 };
const KB = 52; // half the width of a class or effect node
const FACT = 62; // half the width of a fact node
const MID = (X.fact + FACT + X.kb - KB) / 2;
const Y = { top: 52, mid: 140, bottom: 228 };

type Edge = { d: string; label: string; lx: number; ly: number; dashed?: boolean };

export function GraphWalk({ pid, first, firstClass, symptom, effect, second, secondClass, status, delay = 0 }: WalkProps) {
  const reduced = useReducedMotion();
  const unknown = (f: WalkFact) => f.state === "unknown" || f.state === "missing";
  // The order Q1 walks: each edge is drawn after the one before it.
  const edges: Edge[] = [
    { d: `M${X.patient + 26} ${Y.mid - 10} Q${X.patient + 60} ${Y.top} ${X.fact - FACT} ${Y.top}`, label: "HAS", lx: 96, ly: 78, dashed: unknown(first) },
    { d: `M${X.fact + FACT} ${Y.top} H${X.kb - KB}`, label: "IN_CLASS", lx: MID, ly: Y.top - 8 },
    { d: `M${X.pattern - 58} ${Y.mid - 12} Q${X.pattern - 70} ${Y.top} ${X.kb + KB} ${Y.top}`, label: "INDEX", lx: 548, ly: 76 },
    { d: `M${X.pattern - 58} ${Y.mid} H${X.kb + KB}`, label: "VIA", lx: 512, ly: Y.mid - 8 },
    { d: `M${X.fact + FACT} ${Y.mid} H${X.kb - KB}`, label: "OF_EFFECT", lx: MID, ly: Y.mid - 8, dashed: unknown(symptom) },
    { d: `M${X.patient + 28} ${Y.mid} H${X.fact - FACT}`, label: "HAS", lx: 120, ly: Y.mid - 8, dashed: unknown(symptom) },
    { d: `M${X.pattern - 58} ${Y.mid + 12} Q${X.pattern - 70} ${Y.bottom} ${X.kb + KB} ${Y.bottom}`, label: "MARKER", lx: 540, ly: 246 },
    { d: `M${X.fact + FACT} ${Y.bottom} H${X.kb - KB}`, label: "IN_CLASS", lx: MID, ly: Y.bottom - 8 },
    { d: `M${X.patient + 26} ${Y.mid + 10} Q${X.patient + 60} ${Y.bottom} ${X.fact - FACT} ${Y.bottom}`, label: "HAS", lx: 96, ly: 206, dashed: unknown(second) },
  ];
  const step = 0.28;
  const at = (i: number) => delay + i * step;
  const appear = (i: number) =>
    reduced ? {} : { initial: { opacity: 0, scale: 0.85 }, animate: { opacity: 1, scale: 1 }, transition: { delay: at(i), duration: 0.35 } };

  return (
    <svg viewBox="0 0 700 290" role="img" className="w-full" aria-label={`Graph walk for ${pid}: ${first.label}, ${symptom.label}, ${second.label}, matched to the pattern through their classes`}>
      {edges.map((e, i) => (
        <g key={i}>
          <motion.path
            d={e.d}
            fill="none"
            stroke="var(--amber)"
            strokeWidth={2}
            strokeDasharray={e.dashed ? "6 5" : undefined}
            initial={reduced ? undefined : e.dashed ? { opacity: 0 } : { pathLength: 0 }}
            animate={reduced ? undefined : e.dashed ? { opacity: 1 } : { pathLength: 1 }}
            transition={{ delay: at(i) + 0.15, duration: 0.4, ease: "easeOut" }}
          />
          <motion.text x={e.lx} y={e.ly} textAnchor="middle" className="fill-[var(--ink-3)] font-mono text-[9.5px]" {...appear(i + 0.5)}>
            {e.label}
          </motion.text>
        </g>
      ))}

      <Node x={X.patient} y={Y.mid} w={52} label="Patient" sub={pid} round motion={appear(0)} />
      <Node x={X.fact} y={Y.top} label={first.label} sub={first.sub} dashed={unknown(first)} motion={appear(0.6)} />
      <Node x={X.kb} y={Y.top} w={KB * 2} label={firstClass} sub="ATC class" kb motion={appear(1.6)} />
      <Node x={X.fact} y={Y.mid} label={symptom.label} sub={symptom.sub} dashed={unknown(symptom)} diamond motion={appear(4.6)} />
      <Node x={X.kb} y={Y.mid} w={KB * 2} label={effect.replace("_", " ")} sub="effect" kb motion={appear(3.6)} />
      <Node x={X.fact} y={Y.bottom} label={second.label} sub={second.sub} dashed={unknown(second)} motion={appear(8.6)} />
      <Node x={X.kb} y={Y.bottom} w={KB * 2} label={secondClass} sub="ATC class" kb motion={appear(7.6)} />

      <motion.g {...appear(2.6)}>
        <rect x={X.pattern - 58} y={Y.mid - 34} width={116} height={68} rx={8} fill="var(--amber-wash)" stroke="var(--amber-ink)" strokeWidth={1.5} />
        <text x={X.pattern} y={Y.mid - 12} textAnchor="middle" className="fill-[var(--amber-ink)] smallcaps text-[9px]">cited pattern</text>
        <text x={X.pattern} y={Y.mid + 6} textAnchor="middle" className="fill-[var(--ink)] font-serif text-[15px]">CCB → swelling</text>
        <text x={X.pattern} y={Y.mid + 22} textAnchor="middle" className="fill-[var(--ink)] font-serif text-[15px]">→ loop diuretic</text>
      </motion.g>
      <motion.foreignObject x={X.pattern - 80} y={Y.mid + 44} width={160} height={28} {...(reduced ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay: at(9.2), duration: 0.4 } })}>
        <div className="flex justify-center">
          <StatusChip status={status} />
        </div>
      </motion.foreignObject>
    </svg>
  );
}

function Node({
  x, y, w = 124, label, sub, dashed, kb, round, diamond, motion: m,
}: {
  x: number; y: number; w?: number; label: string; sub: string; dashed?: boolean; kb?: boolean; round?: boolean; diamond?: boolean;
  motion: object;
}) {
  const h = kb ? 40 : 34;
  return (
    <motion.g {...m} style={{ transformOrigin: `${x}px ${y}px` }}>
      {round ? (
        <circle cx={x} cy={y} r={26} fill="var(--ink)" />
      ) : (
        <rect
          x={x - w / 2} y={y - h / 2} width={w} height={h} rx={kb ? 4 : diamond ? 2 : 20}
          fill={kb ? "var(--ivory)" : "var(--paper)"}
          stroke={dashed ? "var(--ink-3)" : "var(--ink)"} strokeWidth={1.3} strokeDasharray={dashed ? "4 3" : undefined}
        />
      )}
      <text x={x} y={round ? y + 4 : kb ? y - 2 : y + 5} textAnchor="middle" className={round ? "fill-[var(--ivory)] text-[10px] font-medium" : kb ? "fill-[var(--ink)] font-mono text-[10.5px]" : "fill-[var(--ink)] font-serif text-[15px]"}>
        {label}
      </text>
      {!round && (
        <text x={x} y={kb ? y + 12 : y + h / 2 + 13} textAnchor="middle" className="fill-[var(--ink-3)] text-[9.5px]">
          {sub}
        </text>
      )}
    </motion.g>
  );
}
