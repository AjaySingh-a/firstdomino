"use client";

// The patient lab: a visitor places medicines and a symptom on a timeline, the API writes them to
// FalkorDB as a new synthetic patient, and engine/rules.py evaluates the Q1 walk. Next to it, the same
// list read flat (a keyword pair check) shows what a list without the graph would say.

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Database, FlaskConical, Plus, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GraphWalk, type WalkFact } from "@/components/graph-walk";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusChip } from "@/components/status";
import { ApiError, api } from "@/lib/api";
import { STATUS } from "@/lib/present";
import type { FactState, Finding, LabPalette, LabRequest, LabResult, PaletteMedicine } from "@/lib/types";
import { cn } from "@/lib/utils";

type Known = Exclude<FactState, "conflicting">;
type Row = { key: number; name: string; day: number; state: Known; reason: string; reasonState: "documented" | "reported" };
type Symptom = { on: boolean; day: number; state: Known };
type Draft = { rows: Row[]; symptom: Symptom };

const MAX_DAY = 120;
const STATES: { id: Known; label: string }[] = [
  { id: "documented", label: "On record" },
  { id: "reported", label: "Caregiver says" },
  { id: "unknown", label: "Not known" },
];
const REASONS = ["", "ankle swelling", "heart failure", "high blood pressure"];

let nextKey = 1;
const row = (name: string, day: number, over: Partial<Row> = {}): Row => ({
  key: nextKey++, name, day, state: "documented", reason: "", reasonState: "documented", ...over,
});

const PRESETS: { id: string; label: string; hint: string; make: () => Draft }[] = [
  {
    id: "missing", label: "Reason not recorded", hint: "Asks one question",
    make: () => ({ rows: [row("amlodipine", 0, { reason: "high blood pressure" }), row("furosemide", 35)], symptom: { on: true, day: 21, state: "reported" } }),
  },
  {
    id: "other", label: "Another reason on record", hint: "Two explanations",
    make: () => ({ rows: [row("amlodipine", 0), row("furosemide", 35, { reason: "heart failure" })], symptom: { on: true, day: 21, state: "reported" } }),
  },
  {
    id: "order", label: "Wrong order", hint: "Doesn't fit",
    make: () => ({ rows: [row("furosemide", 5), row("amlodipine", 30)], symptom: { on: true, day: 20, state: "documented" } }),
  },
  {
    id: "lookalike", label: "A lookalike medicine", hint: "Different class",
    make: () => ({ rows: [row("diltiazem", 0), row("furosemide", 35)], symptom: { on: true, day: 21, state: "reported" } }),
  },
  {
    id: "two", label: "Two chains, one gap", hint: "Two findings",
    make: () => ({
      rows: [row("nifedipine", 0), row("felodipine", 0, { state: "unknown" }), row("bumetanide", 40, { reason: "ankle swelling", reasonState: "reported" }), row("atorvastatin", 3)],
      symptom: { on: true, day: 18, state: "documented" },
    }),
  },
];

const isCcb = (m?: PaletteMedicine) => !!m && /calcium-channel blocker/i.test(m.group);
const isDiuretic = (m?: PaletteMedicine) => !!m && /diuretic/i.test(m.group);

export default function LabPage() {
  const [palette, setPalette] = useState<LabPalette | null>(null);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => PRESETS[0].make());
  const [preset, setPreset] = useState<string | null>("missing");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ res: LabResult; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.labPalette().then(setPalette, (e) =>
      setPaletteError(e instanceof ApiError && e.status === 503 ? "graph" : "The API is not reachable right now."),
    );
  }, []);

  const meds = useMemo(() => Object.fromEntries((palette?.medicines ?? []).map((m) => [m.name, m])), [palette]);
  const edit = (f: (d: Draft) => Draft) => {
    setDraft((d) => f(structuredClone(d)));
    setPreset(null);
  };
  const setRow = (key: number, patch: Partial<Row>) => edit((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));

  const run = async () => {
    setBusy(true);
    setError(null);
    const body: LabRequest = {
      medicines: draft.rows.map((r) => ({
        name: r.name,
        start_day: r.state === "unknown" ? null : r.day,
        start_state: r.state,
        reason: r.reason || null,
        reason_state: r.reason ? r.reasonState : "unknown",
      })),
      symptom: draft.symptom.on
        ? { onset_day: draft.symptom.state === "unknown" ? null : draft.symptom.day, state: draft.symptom.state }
        : null,
    };
    try {
      const res = await api.createLabPatient(body);
      setResult({ res, draft: structuredClone(draft) });
      requestAnimationFrame(() => document.getElementById("lab-result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      const detail = e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail : null;
      setError(detail ?? "Could not reach the API. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const unused = (palette?.medicines ?? []).filter((m) => !draft.rows.some((r) => r.name === m.name));

  return (
    <>
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
        <SiteHeader current="lab" />

        <main className="flex-1 pb-20">
          <section className="py-10 sm:py-14">
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="smallcaps flex items-center gap-2 text-amber-ink">
              <FlaskConical className="size-3.5" aria-hidden /> Patient lab · live on FalkorDB
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mt-3 font-serif text-[clamp(34px,5.4vw,58px)] leading-[1.02]"
            >
              Build a patient. <em className="text-amber-ink">Watch the graph decide.</em>
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-4 max-w-[58ch] text-[16px] leading-relaxed text-ink-2">
              Nothing here is precomputed. Your patient is written to the graph, walked, and judged by the same rules as the stories.
            </motion.p>
          </section>

          {paletteError === "graph" && (
            <p className="rounded-[8px] border border-amber bg-amber-wash/50 p-5 text-[14px]">
              The lab needs the live graph. Saved snapshots can&rsquo;t evaluate a patient nobody has seen, and that is the point.
            </p>
          )}
          {paletteError && paletteError !== "graph" && <p className="rounded-[8px] border border-coral bg-coral-wash p-5 text-[14px]">{paletteError}</p>}

          {palette && (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Start from">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setDraft(p.make());
                      setPreset(p.id);
                    }}
                    className={cn(
                      "group rounded-full border px-3.5 py-1.5 text-left text-[13px] transition-colors",
                      preset === p.id ? "border-ink bg-ink text-ivory" : "border-rule-strong bg-paper hover:border-ink",
                    )}
                  >
                    {p.label}
                    <span className={cn("ml-2 text-[11px]", preset === p.id ? "text-ivory/70" : "text-ink-3")}>{p.hint}</span>
                  </button>
                ))}
              </div>

              <section className="mt-5 overflow-hidden rounded-[10px] border border-ink bg-paper">
                <Timeline draft={draft} meds={meds} />
                <ul className="divide-y divide-rule border-t border-rule">
                  <AnimatePresence initial={false}>
                    {draft.rows.map((r) => (
                      <motion.li key={r.key} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                        <div className="grid gap-3 px-4 py-3 sm:px-5 md:grid-cols-[180px_1fr_auto_auto] md:items-center">
                          <div>
                            <select
                              aria-label="Medicine"
                              value={r.name}
                              onChange={(e) => setRow(r.key, { name: e.target.value })}
                              className="w-full rounded-[4px] border border-rule-strong bg-ivory px-2 py-1.5 font-serif text-[18px]"
                            >
                              {[meds[r.name], ...unused].filter(Boolean).map((m) => (
                                <option key={m!.name} value={m!.name}>{m!.name}</option>
                              ))}
                            </select>
                            <p className="mt-1 font-mono text-[10.5px] text-ink-3">
                              {meds[r.name]?.drug_class} · {meds[r.name]?.group}
                            </p>
                          </div>
                          <DaySlider value={r.day} disabled={r.state === "unknown"} onChange={(day) => setRow(r.key, { day })} label={`${r.name} start day`} />
                          <Segmented value={r.state} onChange={(state) => setRow(r.key, { state })} label="Start day" />
                          <div className="flex items-center gap-2">
                            <select
                              aria-label={`Why ${r.name} was started`}
                              value={r.reason}
                              onChange={(e) => setRow(r.key, { reason: e.target.value })}
                              className="rounded-[4px] border border-rule-strong bg-ivory px-2 py-1.5 text-[12.5px]"
                            >
                              {REASONS.map((x) => (
                                <option key={x} value={x}>{x ? `for ${x}` : "reason not recorded"}</option>
                              ))}
                            </select>
                            {r.reason && (
                              <button
                                type="button"
                                onClick={() => setRow(r.key, { reasonState: r.reasonState === "documented" ? "reported" : "documented" })}
                                className="rounded-full border border-rule-strong px-2 py-1 text-[11px] text-ink-2 hover:border-ink"
                                title="Who says so"
                              >
                                {r.reasonState === "documented" ? "on record" : "caregiver"}
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`Remove ${r.name}`}
                              disabled={draft.rows.length === 1}
                              onClick={() => edit((d) => ({ ...d, rows: d.rows.filter((x) => x.key !== r.key) }))}
                              className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-ivory hover:text-ink disabled:opacity-30"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                  <li className="grid gap-3 bg-ivory/60 px-4 py-3 sm:px-5 md:grid-cols-[180px_1fr_auto_auto] md:items-center">
                    <label className="flex items-center gap-2 font-serif text-[18px]">
                      <input type="checkbox" checked={draft.symptom.on} onChange={(e) => edit((d) => ({ ...d, symptom: { ...d.symptom, on: e.target.checked } }))} className="accent-[var(--amber-ink)]" />
                      Ankle swelling
                    </label>
                    <DaySlider value={draft.symptom.day} disabled={!draft.symptom.on || draft.symptom.state === "unknown"} onChange={(day) => edit((d) => ({ ...d, symptom: { ...d.symptom, day } }))} label="Swelling onset day" />
                    <Segmented value={draft.symptom.state} disabled={!draft.symptom.on} onChange={(state) => edit((d) => ({ ...d, symptom: { ...d.symptom, state } }))} label="Onset day" />
                    <span className="text-[11.5px] text-ink-3">{draft.symptom.on ? "symptom" : "none on record"}</span>
                  </li>
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    disabled={draft.rows.length >= 5 || unused.length === 0}
                    onClick={() => edit((d) => ({ ...d, rows: [...d.rows, row(unused[0].name, 10)] }))}
                    className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
                  >
                    <Plus className="size-4" /> Add a medicine
                  </button>
                  <button
                    type="button"
                    onClick={run}
                    disabled={busy}
                    className="inline-flex h-11 items-center gap-2 rounded-[6px] border border-ink bg-ink px-5 text-[15px] font-medium text-ivory transition-colors hover:bg-ink-2 disabled:opacity-60"
                  >
                    <Database className={cn("size-4", busy && "animate-pulse")} aria-hidden />
                    {busy ? "Writing to FalkorDB…" : "Write to the graph and walk it"}
                  </button>
                </div>
                {error && <p className="border-t border-coral bg-coral-wash px-5 py-3 text-[13px]">{error}</p>}
              </section>
            </>
          )}

          <AnimatePresence mode="wait">
            {result && palette && (
              <motion.div key={result.res.patient.id} id="lab-result" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="scroll-mt-6">
                <Result result={result.res} draft={result.draft} meds={meds} palette={palette} onAgain={() => setResult(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <p className="text-[12px] text-ink-3">Every lab patient is synthetic and is deleted on reset.</p>
      </div>
      <SiteFooter className="mt-6" />
    </>
  );
}

// Known days sit on 2–80% of the width; "day ?" has its own column at the right end, so the two never meet.
const dayX = (day: number) => (Math.min(day, MAX_DAY) / MAX_DAY) * 78 + 2;
const UNKNOWN_X = 96;

function Timeline({ draft, meds }: { draft: Draft; meds: Record<string, PaletteMedicine> }) {
  const marks = [
    ...draft.rows.map((r) => ({ key: `m${r.key}`, label: r.name, day: r.day, state: r.state, kind: isCcb(meds[r.name]) ? "first" : isDiuretic(meds[r.name]) ? "second" : "other" })),
    ...(draft.symptom.on ? [{ key: "s", label: "swelling", day: draft.symptom.day, state: draft.symptom.state, kind: "symptom" }] : []),
  ]
    .map((m) => ({ ...m, left: m.state === "unknown" ? UNKNOWN_X : dayX(m.day) }))
    .sort((a, b) => a.left - b.left);
  return (
    <div className="relative px-4 pb-4 pt-6 sm:px-5" aria-hidden>
      <div className="relative h-[100px]">
        <div className="absolute inset-x-0 top-[66px] h-px bg-ink" />
        {[0, 30, 60, 90, 120].map((d) => (
          <span key={d} className={cn("absolute top-[72px] font-mono text-[10px] text-ink-3", d > 0 && "-translate-x-1/2")} style={{ left: `${d === 0 ? 0 : dayX(d)}%` }}>
            d{d}
          </span>
        ))}
        <span className="absolute right-0 top-[72px] font-mono text-[10px] text-ink-3">day ?</span>
        {marks.map((m, i) => {
          const unknown = m.state === "unknown";
          // Labels near an edge grow inwards; neighbours (in day order) sit on different rows.
          const align = m.left < 14 ? "left-[-6px]" : m.left > 82 ? "right-[-6px]" : "left-0 -translate-x-1/2";
          return (
            <motion.div
              key={m.key}
              className="absolute top-0 w-0"
              initial={false}
              animate={{ left: `${m.left}%` }}
              transition={{ type: "spring", stiffness: 220, damping: 26 }}
              style={{ zIndex: 10 + i }}
            >
              <span
                className={cn("absolute whitespace-nowrap font-serif text-[14px] leading-none", align, m.kind === "other" ? "text-ink-3" : "text-ink")}
                style={{ top: (i % 3) * 18 }}
              >
                {m.label}
              </span>
              <span
                className={cn(
                  "absolute left-[-6px] top-[60px] size-3 border",
                  m.kind === "symptom" ? "rotate-45" : "rounded-full",
                  unknown ? "border-dashed border-ink-3 bg-transparent" : m.state === "reported" ? "border-ink bg-paper" : m.kind === "other" ? "border-ink-3 bg-ink-3" : "border-ink bg-ink",
                  m.kind === "first" && !unknown && "bg-amber",
                )}
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function DaySlider({ value, onChange, disabled, label }: { value: number; onChange: (d: number) => void; disabled?: boolean; label: string }) {
  return (
    <div className={cn("flex items-center gap-3", disabled && "opacity-40")}>
      <input type="range" min={0} max={MAX_DAY} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--ink)]" />
      <span className="tabular w-14 shrink-0 whitespace-nowrap font-mono text-[12px] text-ink-2">{disabled ? "day ?" : `day ${value}`}</span>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, disabled, label }: { value: T; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-full border border-rule-strong p-0.5", disabled && "opacity-40")}>
      {STATES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          disabled={disabled}
          onClick={() => onChange(s.id as T)}
          className={cn("rounded-full px-2.5 py-1 text-[11.5px] transition-colors", value === s.id ? "bg-ink text-ivory" : "text-ink-2 hover:text-ink")}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ---------- the result ----------

const nameOf = (factId: string) => factId.split(":")[1]?.replace(/^(ep|obs)-/, "") ?? factId;
const reqKinds = (f: Finding) => f.requirement_ids.map((id) => id.split("-").pop() ?? "");

function why(f: Finding, second: string): string {
  const kinds = reqKinds(f);
  if (f.status === "not_matched") return `The flat list flags it anyway. The graph checked the order, and it doesn't fit.`;
  if (f.status === "competing_explanation") return `The flat list ignores the reason for ${second}. The graph puts it side by side.`;
  if (kinds.includes("onset_day") && f.observation_ids.length === 0) return "The flat list flags with no symptom on record. The graph asks whether one happened.";
  if (kinds.includes("indication")) return `The flat list can't tell "not recorded" from "no reason". The graph asks why ${second} was started.`;
  if (kinds.includes("order")) return "The order isn't settled. The graph asks instead of guessing.";
  if (kinds.length) return "A date is not known. The flat list has nothing to check; the graph asks for it.";
  return "Both flag it. Only the graph can say which facts it rests on and how sure each one is.";
}

function Result({ result, draft, meds, palette, onAgain }: { result: LabResult; draft: Draft; meds: Record<string, PaletteMedicine>; palette: LabPalette; onAgain: () => void }) {
  const { patient, findings, steps } = result;
  const pattern = palette.patterns[0];
  const byName = Object.fromEntries(draft.rows.map((r) => [r.name, r]));
  const fact = (name: string): WalkFact => {
    const r = byName[name];
    const day = r && r.state !== "unknown" ? `day ${r.day}` : "day not known";
    return { label: name, sub: `${day}${r?.reason ? ` · for ${r.reason}` : ""}`, state: r?.state ?? "unknown" };
  };
  const symptom: WalkFact = draft.symptom.on
    ? { label: "ankle swelling", sub: draft.symptom.state === "unknown" ? "day not known" : `day ${draft.symptom.day}`, state: draft.symptom.state }
    : { label: "ankle swelling?", sub: "not on record", state: "missing" };

  // The flat reading: a calcium-channel blocker and a diuretic on the same list, by their names.
  const flatPairs = draft.rows.flatMap((a) => (isCcb(meds[a.name]) ? draft.rows.filter((b) => isDiuretic(meds[b.name])).map((b) => [a.name, b.name] as const) : []));
  const graphPair = (a: string, b: string) => findings.find((f) => nameOf(f.index_episode_id) === a && nameOf(f.marker_episode_id) === b);
  const deadEnds = draft.rows.filter((r) => ![pattern.index_class, pattern.marker_class].includes(meds[r.name]?.drug_class ?? ""));
  const total = steps.reduce((s, x) => s + x.ms, 0);
  const outsider = (a: string, b: string) => {
    const out = [a, b].find((n) => ![pattern.index_class, pattern.marker_class].includes(meds[n]?.drug_class ?? "")) ?? b;
    return `${out} is in class ${meds[out]?.drug_class}, outside the cited pattern. A name match can't see that; the class edge can.`;
  };

  return (
    <section className="mt-10 border-t border-ink pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="smallcaps text-ink-3">Written to FalkorDB as</p>
          <h2 className="font-mono text-[22px]">{patient.id}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onAgain} className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-ink px-4 text-[14px] hover:bg-paper">
            <RotateCcw className="size-4" /> Change it
          </button>
          <Link href={`/patients/${patient.id}`} className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-ink bg-ink px-4 text-[14px] font-medium text-ivory hover:bg-ink-2">
            Open the full review <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>

      <ol className="mt-5 grid gap-px overflow-hidden rounded-[8px] border border-ink bg-ink font-mono text-[12px] sm:grid-cols-4">
        {steps.map((s, i) => (
          <motion.li key={s.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.18 }} className="bg-ivory p-3">
            <p className="flex items-baseline justify-between gap-2">
              <span className="truncate text-ink">{s.name}</span>
              <span className="tabular shrink-0 text-amber-ink">{s.ms} ms</span>
            </p>
            <p className="mt-1 font-sans text-[11.5px] leading-snug text-ink-3">{s.detail}</p>
          </motion.li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] text-ink-3">
        {Math.round(total)} ms on the live graph, start to finish. Every step is a named Cypher query starting from <span className="font-mono">Patient {"{"}id: &quot;{patient.id}&quot;{"}"}</span>.
      </p>

      <div className="mt-8 grid gap-6">
        {findings.length === 0 && (
          <div className="rounded-[10px] border border-rule-strong bg-paper p-6">
            <p className="font-serif text-[26px]">No chain in the graph.</p>
            <p className="mt-1 text-[14px] text-ink-2">No walk from these medicines reaches the cited pattern. Nothing to review, so nothing is raised.</p>
          </div>
        )}
        {findings.map((f, i) => {
          const a = nameOf(f.index_episode_id);
          const b = nameOf(f.marker_episode_id);
          return (
            <motion.article key={f.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 + i * 0.3 }} className="min-w-0 rounded-[10px] border border-ink bg-paper p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <StatusChip status={f.status} />
                <p className="font-serif text-[22px] leading-tight">{f.headline}</p>
              </div>
              <p className="mt-1 text-[13px] text-ink-3">{STATUS[f.status].blurb}</p>
              <div className="mt-4 overflow-x-auto">
                <div className="min-w-[560px]">
                  <GraphWalk
                    pid={patient.id}
                    first={fact(a)}
                    firstClass={meds[a]?.drug_class ?? pattern.index_class}
                    symptom={symptom}
                    effect={pattern.via_effect}
                    second={fact(b)}
                    secondClass={meds[b]?.drug_class ?? pattern.marker_class}
                    status={f.status}
                    delay={0.8 + i * 0.3}
                  />
                </div>
              </div>
            </motion.article>
          );
        })}
      </div>

      {deadEnds.length > 0 && (
        <p className="mt-4 text-[13px] text-ink-2">
          <span className="smallcaps mr-2 text-ink-3">Dead ends</span>
          {deadEnds.map((r, i) => (
            <span key={r.key}>
              {i > 0 && " · "}
              {r.name} <span className="font-mono text-[11.5px] text-ink-3">→ {meds[r.name]?.drug_class}</span>
            </span>
          ))}
          <span className="text-ink-3"> · no edge from these classes into the pattern ({pattern.index_class} → {pattern.marker_class}).</span>
        </p>
      )}

      <section className="mt-10">
        <h3 className="font-serif text-[30px] leading-tight">The same list, read without the graph</h3>
        <p className="mt-1 max-w-[62ch] text-[14px] text-ink-2">
          A flat check sees names on a list: <em>a calcium-channel blocker and a diuretic, together</em>. No dates, no sources, no &ldquo;not known yet&rdquo;.
        </p>
        <div className="mt-4 overflow-hidden rounded-[8px] border border-ink">
          <div className="grid grid-cols-[1.1fr_0.7fr_1fr] bg-ink px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ivory">
            <span>Pair</span>
            <span>Flat list</span>
            <span>Graph</span>
          </div>
          {flatPairs.length === 0 && findings.length === 0 && <p className="bg-paper px-4 py-3 text-[13px] text-ink-3">Neither raises anything for this list.</p>}
          {flatPairs.map(([a, b], i) => {
            const f = graphPair(a, b);
            return (
              <motion.div key={`${a}-${b}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.2 + i * 0.15 }} className="border-t border-rule bg-paper px-4 py-3">
                <div className="grid grid-cols-[1.1fr_0.7fr_1fr] items-center gap-2">
                  <span className="font-serif text-[17px]">{a} → {b}</span>
                  <span className="text-[13px] font-medium text-coral">Flag</span>
                  <span>{f ? <StatusChip status={f.status} /> : <span className="text-[13px] text-ink-2">No chain</span>}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-3">
                  {f ? why(f, b) : outsider(a, b)}
                </p>
              </motion.div>
            );
          })}
          <div className="border-t border-rule bg-amber-wash/40 px-4 py-3 text-[12.5px] text-ink-2">
            <strong className="font-medium text-ink">Later, one date changes.</strong> A flat list re-checks everything. The graph follows the changed fact&rsquo;s edges and re-checks only the findings linked to it (query Q3). Try it in the full review.
          </div>
        </div>
      </section>
    </section>
  );
}
