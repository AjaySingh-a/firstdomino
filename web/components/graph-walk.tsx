"use client";

// The walk behind one finding, drawn from the path FalkorDB returned (q11: nodes(path) and
// relationships(path)), not rebuilt here. Node i of the walk sits in a fixed slot, each edge carries the
// relationship type the query returned and an arrow in its stored direction, and the edges are drawn in
// path order: first medicine -> ingredient -> class <- pattern -> class <- ingredient <- second medicine,
// then pattern -> effect <- symptom. A fact whose day is not known is dashed. Still under reduced motion.

import { motion, useReducedMotion } from "framer-motion";
import { StatusChip } from "@/components/status";
import type { FindingPath, FindingStatus, PathNode } from "@/lib/types";

export interface WalkProps {
  path: FindingPath;
  status: FindingStatus;
  delay?: number;
}

const X = { ep: 64, ing: 212, cls: 384, pat: 600 };
const Y = { top: 52, mid: 145, bottom: 238 };
type Slot = { x: number; y: number; w: number };
// Where walk node i goes; the walk is U-shaped around the pattern on the right.
const WALK: Slot[] = [
  { x: X.ep, y: Y.top, w: 116 }, { x: X.ing, y: Y.top, w: 100 }, { x: X.cls, y: Y.top, w: 84 },
  { x: X.pat, y: Y.mid, w: 132 },
  { x: X.cls, y: Y.bottom, w: 84 }, { x: X.ing, y: Y.bottom, w: 100 }, { x: X.ep, y: Y.bottom, w: 116 },
];
// pattern -> effect <- symptom
const SIDE: Slot[] = [WALK[3], { x: X.cls, y: Y.mid, w: 116 }, { x: X.ing, y: Y.mid, w: 100 }];

const isFact = (n: PathNode) => n.label === "MedicationEpisode" || n.label === "Observation";
const unknown = (n: PathNode) => isFact(n) && (n.happened_at === null || n.happened_at === undefined || n.state === "unknown");

function sub(n: PathNode): string {
  if (isFact(n)) {
    const day = n.happened_at === null || n.happened_at === undefined ? "day not known" : `day ${n.happened_at}`;
    return n.state === "reported" ? `${day} · caregiver` : day;
  }
  return { Ingredient: "ingredient", DrugClass: "ATC class", Effect: "effect" }[n.label] ?? n.label;
}

/** The edge between two slots: a straight line on one row, a curve into the pattern otherwise. */
function edgePath(a: Slot, b: Slot, forward: boolean) {
  const [l, r] = a.x < b.x ? [a, b] : [b, a];
  const x1 = l.x + l.w / 2;
  const x2 = r.x - r.w / 2;
  const d = l.y === r.y ? `M${x1} ${l.y} H${x2}` : `M${x1} ${l.y} Q${x2 - 24} ${l.y} ${x2} ${r.y + (l.y < r.y ? -14 : 14)}`;
  // Draw from the edge's source, so the arrow head lands on its target.
  const fromLeft = (a.x < b.x) === forward;
  const rev = l.y === r.y ? `M${x2} ${l.y} H${x1}` : `M${x2} ${r.y + (l.y < r.y ? -14 : 14)} Q${x2 - 24} ${l.y} ${x1} ${l.y}`;
  return { d: fromLeft ? d : rev, lx: (x1 + x2) / 2 + (l.y === r.y ? 0 : 18), ly: l.y === r.y ? l.y - 8 : (l.y + r.y) / 2 + (l.y < r.y ? -18 : 22) };
}

export function GraphWalk({ path, status, delay = 0 }: WalkProps) {
  const reduced = useReducedMotion();
  const { walk, sides } = path;
  const side = sides[0];
  const edges = [
    ...walk.edges.map((e, i) => ({ ...e, a: WALK[i], b: WALK[i + 1], dashed: unknown(walk.nodes[i]) || unknown(walk.nodes[i + 1]) })),
    ...(side?.edges ?? []).map((e, i) => ({ ...e, a: SIDE[i], b: SIDE[i + 1], dashed: unknown(side.nodes[i + 1]) })),
  ];
  const step = 0.26;
  const at = (i: number) => delay + i * step;
  const appear = (i: number) =>
    reduced ? {} : { initial: { opacity: 0, scale: 0.85 }, animate: { opacity: 1, scale: 1 }, transition: { delay: at(i), duration: 0.35 } };
  const nodes: { n: PathNode; s: Slot; i: number }[] = [
    ...walk.nodes.slice(0, 7).map((n, i) => ({ n, s: WALK[i], i })),
    ...(side ? side.nodes.slice(1).map((n, i) => ({ n, s: SIDE[i + 1], i: walk.edges.length + i + 1 })) : []),
  ];
  const names = walk.nodes.filter((n) => n.label === "MedicationEpisode").map((n) => n.name);

  return (
    <svg
      viewBox="0 0 700 290"
      role="img"
      className="w-full"
      aria-label={`The path FalkorDB returned for ${path.finding_id}: ${walk.nodes.map((n) => n.name).join(", ")}${side ? `, and ${side.nodes.at(-1)?.name}` : ""}`}
    >
      <defs>
        <marker id="fd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--amber-ink)" />
        </marker>
      </defs>
      {edges.map((e, i) => {
        const g = edgePath(e.a, e.b, e.forward);
        return (
          <g key={i}>
            <motion.path
              d={g.d}
              fill="none"
              stroke="var(--amber)"
              strokeWidth={2}
              markerEnd="url(#fd-arrow)"
              strokeDasharray={e.dashed ? "6 5" : undefined}
              initial={reduced ? undefined : e.dashed ? { opacity: 0 } : { pathLength: 0 }}
              animate={reduced ? undefined : e.dashed ? { opacity: 1 } : { pathLength: 1 }}
              transition={{ delay: at(i + 1), duration: 0.4, ease: "easeOut" }}
            />
            <motion.text x={g.lx} y={g.ly} textAnchor="middle" className="fill-[var(--ink-3)] font-mono text-[9px]" {...appear(i + 1.4)}>
              {e.type}
            </motion.text>
          </g>
        );
      })}

      {nodes.map(({ n, s, i }) =>
        n.label === "Pattern" ? (
          <motion.g key={`n${i}`} {...appear(i)} style={{ transformOrigin: `${s.x}px ${s.y}px` }}>
            <rect x={s.x - s.w / 2} y={s.y - 30} width={s.w} height={60} rx={8} fill="var(--amber-wash)" stroke="var(--amber-ink)" strokeWidth={1.5} />
            <text x={s.x} y={s.y - 8} textAnchor="middle" className="smallcaps fill-[var(--amber-ink)] text-[9px]">
              cited pattern
            </text>
            <text x={s.x} y={s.y + 10} textAnchor="middle" className="fill-[var(--ink)] font-mono text-[9.5px]">
              {n.id}
            </text>
          </motion.g>
        ) : (
          <Node key={`n${i}`} slot={s} node={n} motion={appear(i)} />
        ),
      )}

      <motion.foreignObject
        x={X.pat - 80}
        y={Y.mid + 40}
        width={160}
        height={28}
        {...(reduced ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay: at(edges.length + 1), duration: 0.4 } })}
      >
        <div className="flex justify-center" title={`${names.join(" then ")}: the rules set this status`}>
          <StatusChip status={status} />
        </div>
      </motion.foreignObject>
    </svg>
  );
}

function Node({ slot: { x, y, w }, node, motion: m }: { slot: Slot; node: PathNode; motion: object }) {
  const fact = isFact(node);
  const dashed = unknown(node);
  const h = fact ? 34 : 38;
  return (
    <motion.g {...m} style={{ transformOrigin: `${x}px ${y}px` }}>
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={fact ? (node.label === "Observation" ? 3 : 18) : 4}
        fill={fact ? "var(--paper)" : "var(--ivory)"}
        stroke={dashed ? "var(--ink-3)" : "var(--ink)"}
        strokeWidth={1.3}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <text
        x={x}
        y={fact ? y + 5 : y - 1}
        textAnchor="middle"
        className={fact ? "fill-[var(--ink)] font-serif text-[14px]" : "fill-[var(--ink)] font-mono text-[10.5px]"}
      >
        {node.name.replace("_", " ")}
      </text>
      <text x={x} y={fact ? y + h / 2 + 12 : y + 12} textAnchor="middle" className="fill-[var(--ink-3)] text-[9px]">
        {sub(node)}
      </text>
    </motion.g>
  );
}
