"use client";

// The Medication River: one lane per medication episode, a symptom lane, visit boundaries,
// and each finding drawn as arcs between the facts it links.
//   solid           documented link
//   dashed          a fact the link depends on is unknown
//   amber hatch     conflicting
// Lanes are ordered so a finding reads top to bottom: first medicine, symptom, second medicine.

import { scaleLinear } from "d3-scale";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LINK_LABEL,
  SOURCE_KIND,
  STATUS,
  findingLinks,
  shortDay,
  type FindingLink,
  type Tone,
} from "@/lib/present";
import type { AnswerState, Finding, MedicationEpisode, TimelineResponse } from "@/lib/types";

const LABEL_W = 148;
const PAD_R = 40;
const TOP = 78;
const LANE_H = 76;
const AXIS_H = 44;
const MIN_W = 700;

const STROKE: Record<Tone, string> = { amber: "var(--amber)", teal: "var(--teal)", muted: "var(--ink-3)" };
const TEXT: Record<Tone, string> = { amber: "var(--amber-ink)", teal: "var(--teal)", muted: "var(--ink-3)" };

type Row = { type: "episode"; e: MedicationEpisode } | { type: "symptoms" };
type Pt = { x: number; y: number };

interface Props {
  timeline: TimelineResponse;
  findings: Finding[];
  selectedId: string | null;
  lit: Set<string> | null;
  onSelect: (id: string | null) => void;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(MIN_W);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const fade = (lit: Set<string> | null, id: string) => (!lit || lit.has(id) ? 1 : 0.2);

function markerStyle(state: AnswerState) {
  switch (state) {
    case "documented":
      return { fill: "var(--ink)", stroke: "var(--ink)", dash: undefined };
    case "reported":
      return { fill: "var(--ivory)", stroke: "var(--ink)", dash: undefined };
    case "conflicting":
      return { fill: "url(#hatch-amber)", stroke: "var(--amber)", dash: undefined };
    default:
      return { fill: "var(--ivory)", stroke: "var(--ink-3)", dash: "2 2" };
  }
}

export function MedicationRiver({ timeline, findings, selectedId, lit, onSelect }: Props) {
  const [wrapRef, measured] = useWidth<HTMLDivElement>();
  const W = Math.max(MIN_W, measured);
  const { episodes, observations, sources, patient, pending_evidence } = timeline;

  const rows = useMemo<Row[]>(() => {
    const indexIds = new Set(findings.map((f) => f.index_episode_id));
    const byStart = (a: MedicationEpisode, b: MedicationEpisode) => (a.happened_at ?? 1e9) - (b.happened_at ?? 1e9);
    const upper = episodes.filter((e) => indexIds.has(e.id)).sort(byStart);
    const lower = episodes.filter((e) => !indexIds.has(e.id)).sort(byStart);
    return [
      ...upper.map((e) => ({ type: "episode" as const, e })),
      ...(observations.length ? [{ type: "symptoms" as const }] : []),
      ...lower.map((e) => ({ type: "episode" as const, e })),
    ];
  }, [episodes, observations.length, findings]);

  const H = TOP + LANE_H * rows.length + AXIS_H;
  const laneY = (i: number) => TOP + LANE_H * i + LANE_H / 2;
  const symY = laneY(rows.findIndex((r) => r.type === "symptoms"));
  const bottom = H - AXIS_H;

  const x = useMemo(() => {
    const days = [
      0,
      patient.as_of_day,
      ...episodes.flatMap((e) => [e.happened_at, e.stop_day]),
      ...observations.map((o) => o.happened_at),
      ...sources.map((s) => s.happened_at),
      ...pending_evidence.map((p) => (typeof p.change.value === "number" ? p.change.value : null)),
    ].filter((d): d is number => typeof d === "number");
    return scaleLinear()
      .domain([Math.min(...days) - 3, Math.max(...days) + 3])
      .range([LABEL_W, W - PAD_R]);
  }, [W, patient.as_of_day, episodes, observations, sources, pending_evidence]);
  const [d0] = x.domain();
  const xd = (d: number | null) => x(d ?? d0);

  const points = useMemo(() => {
    const m = new Map<string, Pt>();
    rows.forEach((r, i) => {
      if (r.type === "episode") m.set(r.e.id, { x: xd(r.e.happened_at), y: laneY(i) });
    });
    observations.forEach((o) => m.set(o.id, { x: xd(o.happened_at), y: symY }));
    return m;
  }, [rows, observations, x, symY]); // eslint-disable-line react-hooks/exhaustive-deps

  // Visit boundaries, labels staggered over two rows when they crowd.
  const visits = useMemo(() => {
    const lastX = [-Infinity, -Infinity];
    return [...sources]
      .filter((s) => s.happened_at !== null)
      .sort((a, b) => (a.happened_at as number) - (b.happened_at as number))
      .map((s) => {
        const sx = x(s.happened_at as number);
        const row = sx - lastX[0] >= 78 ? 0 : sx - lastX[1] >= 78 ? 1 : 0;
        lastX[row] = sx;
        return { s, sx, row };
      });
  }, [sources, x]);

  const ticks = x.ticks(Math.max(4, Math.floor((W - LABEL_W) / 90))).filter((t) => Number.isInteger(t));

  const arcs = findings.flatMap((f) =>
    findingLinks(f, timeline).map((link) => ({ f, link, tone: STATUS[f.status].tone })),
  );

  return (
    <div ref={wrapRef} className="w-full">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Medication river for ${patient.label}: ${episodes.length} medicines, ${observations.length} symptoms, ${findings.length} findings`}
        className="block select-none"
      >
        <defs>
          <pattern id="hatch-amber" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--amber-wash)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--amber)" strokeWidth="2.4" />
          </pattern>
          {(["amber", "teal", "muted"] as Tone[]).map((t) => (
            <marker key={t} id={`arrow-${t}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1 L6 4 L1 7" fill="none" stroke={STROKE[t]} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          ))}
        </defs>

        {/* Click on paper to clear the selection. */}
        <rect width={W} height={H} fill="transparent" onClick={() => onSelect(null)} />

        {/* Lane rules */}
        {rows.map((_, i) => (
          <line key={i} x1={0} x2={W} y1={TOP + LANE_H * i} y2={TOP + LANE_H * i} stroke="var(--rule)" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={bottom} y2={bottom} stroke="var(--rule-strong)" strokeWidth={1} />

        {/* Visit boundaries */}
        {visits.map(({ s, sx, row }) => (
          <motion.g key={s.id} animate={{ opacity: fade(lit, s.id) }} transition={{ duration: 0.3 }}>
            <line x1={sx} x2={sx} y1={TOP - 10} y2={bottom} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="1 4" strokeLinecap="round" />
            <text x={sx} y={22 + row * 22} textAnchor="middle" className="fill-[var(--ink-2)] text-[10.5px] font-medium uppercase tracking-[0.1em]">
              {SOURCE_KIND[s.kind].short}
            </text>
            <text x={sx} y={34 + row * 22} textAnchor="middle" className="fill-[var(--ink-3)] tabular text-[10.5px]">
              {shortDay(s.happened_at)}
              {s.recorded_at !== s.happened_at ? ` · rec ${shortDay(s.recorded_at)}` : ""}
            </text>
          </motion.g>
        ))}

        {/* Review date */}
        <g>
          <line x1={x(patient.as_of_day)} x2={x(patient.as_of_day)} y1={bottom} y2={bottom + 8} stroke="var(--ink)" strokeWidth={1.5} />
          <text x={x(patient.as_of_day)} y={bottom + 34} textAnchor="end" className="fill-[var(--ink)] text-[10.5px] font-medium uppercase tracking-[0.1em]">
            as of {shortDay(patient.as_of_day)}
          </text>
        </g>

        {/* Axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={bottom} y2={bottom + 4} stroke="var(--rule-strong)" />
            <text x={x(t)} y={bottom + 18} textAnchor="middle" className="tabular fill-[var(--ink-3)] tabular text-[10.5px]">
              {t}
            </text>
          </g>
        ))}
        <text x={12} y={bottom + 18} className="fill-[var(--ink-3)] text-[10.5px] uppercase tracking-[0.12em]">
          Day
        </text>

        {/* Lanes */}
        {rows.map((r, i) => {
          const y = laneY(i);
          if (r.type === "symptoms") {
            return (
              <g key="symptoms">
                <text x={12} y={y + 4} className="fill-[var(--ink-3)] text-[10.5px] font-medium uppercase tracking-[0.12em]">
                  Symptoms
                </text>
                {observations.map((o) => {
                  const p = { x: xd(o.happened_at), y };
                  const m = markerStyle(o.happened_at === null ? "unknown" : o.state);
                  return (
                    <motion.g key={o.id} animate={{ opacity: fade(lit, o.id) }} transition={{ duration: 0.3 }}>
                      <rect x={p.x - 6} y={p.y - 6} width={12} height={12} transform={`rotate(45 ${p.x} ${p.y})`} fill={m.fill} stroke={m.stroke} strokeWidth={1.5} strokeDasharray={m.dash} />
                      <text x={p.x + 14} y={p.y - 2} className="fill-[var(--ink)] text-[12.5px]">
                        {o.label}
                      </text>
                      <text x={p.x + 14} y={p.y + 12} className="fill-[var(--ink-3)] tabular text-[10.5px]">
                        {shortDay(o.happened_at)} · {o.state === "reported" ? "reported" : o.state}
                      </text>
                    </motion.g>
                  );
                })}
              </g>
            );
          }
          const e = r.e;
          const start = xd(e.happened_at);
          const end = x(e.stop_day ?? patient.as_of_day);
          const m = markerStyle(e.happened_at === null ? "unknown" : e.state);
          const ind =
            e.indication_state === "unknown"
              ? "reason not known yet"
              : e.indication_state === "not_available"
                ? "reason not available"
                : `for ${e.indication}`;
          return (
            <motion.g key={e.id} animate={{ opacity: fade(lit, e.id) }} transition={{ duration: 0.3 }}>
              <text x={12} y={y + 1} className="fill-[var(--ink)] font-serif text-[19px]">
                {e.ingredient.name}
              </text>
              <text x={12} y={y + 16} className="fill-[var(--ink-3)] text-[10.5px]">
                {e.prescriber_specialty?.replace(/_/g, " ") ?? "prescriber not known"}
              </text>
              <rect x={start} y={y - 5} width={Math.max(0, end - start)} height={10} rx={5} fill="var(--ink)" fillOpacity={0.07} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray={e.state === "documented" ? undefined : "3 3"} />
              {e.stop_day === null && (
                <path d={`M${end - 1} ${y - 5} l6 5 l-6 5`} fill="none" stroke="var(--ink-2)" strokeWidth={1} />
              )}
              <circle cx={start} cy={y} r={6} fill={m.fill} stroke={m.stroke} strokeWidth={1.5} strokeDasharray={m.dash} />
              <text
                x={start + 12}
                y={y - 12}
                className={
                  e.indication_state === "unknown" || e.indication_state === "not_available"
                    ? "fill-[var(--ink-3)] text-[11.5px] italic"
                    : "fill-[var(--ink-2)] text-[11.5px]"
                }
              >
                {ind}
                {e.indication_state === "reported" ? " (reported)" : ""}
              </text>
              <text x={start + 12} y={y + 22} className="fill-[var(--ink-3)] tabular text-[10.5px]">
                {e.dose_text} · {shortDay(e.happened_at)}
              </text>
            </motion.g>
          );
        })}

        {/* Pending corrections, drawn as ghosts */}
        {pending_evidence.map((req) => {
          if (req.change.field !== "happened_at" || typeof req.change.value !== "number") return null;
          const p = points.get(req.change.fact_id);
          if (!p) return null;
          const gx = x(req.change.value);
          return (
            <g key={req.event_id} opacity={lit && !lit.has(req.change.fact_id) ? 0.2 : 1}>
              <line x1={gx + 8} x2={p.x - 9} y1={p.y} y2={p.y} stroke="var(--amber)" strokeWidth={1} strokeDasharray="2 3" />
              <rect x={gx - 6} y={p.y - 6} width={12} height={12} transform={`rotate(45 ${gx} ${p.y})`} fill="var(--ivory)" stroke="var(--amber)" strokeWidth={1.5} strokeDasharray="2 2" />
              <text x={gx} y={p.y + 26} textAnchor="middle" className="fill-[var(--amber-ink)] tabular text-[10.5px]">
                pending {shortDay(req.change.value)}
              </text>
            </g>
          );
        })}

        {/* Findings as arcs */}
        {arcs.map(({ f, link, tone }) => (
          <Arc
            key={`${link.key}:${selectedId === f.id}`}
            link={link}
            from={points.get(link.fromId)}
            to={points.get(link.toId)}
            tone={tone}
            selected={selectedId === f.id}
            dimmed={selectedId !== null && selectedId !== f.id}
            title={f.headline}
            onSelect={() => onSelect(f.id)}
          />
        ))}
      </svg>
    </div>
  );
}

function Arc({
  link,
  from,
  to,
  tone,
  selected,
  dimmed,
  title,
  onSelect,
}: {
  link: FindingLink;
  from?: Pt;
  to?: Pt;
  tone: Tone;
  selected: boolean;
  dimmed: boolean;
  title: string;
  onSelect: () => void;
}) {
  if (!from || !to) return null;
  const dy = Math.sign(to.y - from.y) || 1;
  const dx = Math.sign(to.x - from.x) || 1;
  const x1 = from.x;
  const y1 = from.y + dy * 9;
  const x2 = to.x - dx * 11;
  const y2 = to.y;
  // Leaves the first fact vertically, arrives at the second horizontally, like a domino tipping over.
  const d = Math.abs(to.x - from.x) < 4 ? `M${x1} ${y1} L${to.x} ${to.y - dy * 9}` : `M${x1} ${y1} Q${x1} ${y2} ${x2} ${y2}`;
  // Label at the curve's vertical midpoint (t where y is halfway), just right of the line.
  const t = 1 - Math.SQRT1_2;
  const lx = x1 + t * t * (x2 - x1) + 10;
  const ly = (y1 + y2) / 2 + 4;
  const days = link.fromDay !== null && link.toDay !== null ? `${link.toDay - link.fromDay} d` : "? d";
  const stateLabel = LINK_LABEL[link.state];
  const width = selected ? 2.6 : 2;
  const opacity = dimmed ? 0.15 : 1;

  return (
    <motion.g
      role="button"
      tabIndex={0}
      aria-label={`${title}. Link ${days}${stateLabel ? `, ${stateLabel}` : ", documented"}.`}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity }}
      transition={{ duration: 0.35 }}
      className="cursor-pointer outline-none [&:focus-visible_.focus-ring]:opacity-100"
    >
      <path d={d} fill="none" stroke="transparent" strokeWidth={18} />
      <path className="focus-ring opacity-0" d={d} fill="none" stroke="var(--ink)" strokeWidth={width + 5} strokeOpacity={0.15} />
      {link.state === "conflicting" && <path d={d} fill="none" stroke="url(#hatch-amber)" strokeWidth={9} strokeLinecap="round" />}
      {link.state === "documented" ? (
        <motion.path
          d={d}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={width}
          strokeLinecap="round"
          markerEnd={`url(#arrow-${tone})`}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: [0.55, 0, 0.85, 0.35] }}
        />
      ) : (
        <path
          d={d}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={link.state === "conflicting" ? 1.2 : width}
          strokeDasharray={link.state === "conflicting" ? undefined : "6 5"}
          strokeLinecap="round"
          markerEnd={`url(#arrow-${tone})`}
        />
      )}
      <text
        x={lx}
        y={ly}
        textAnchor="start"
        paintOrder="stroke"
        stroke="var(--ivory)"
        strokeWidth={4}
        strokeLinejoin="round"
        className="tabular text-[10.5px]"
        style={{ fill: TEXT[tone] }}
      >
        {days}
        {stateLabel ? ` · ${stateLabel}` : ""}
      </text>
    </motion.g>
  );
}
