"use client";

import { AnimatePresence, motion } from "framer-motion";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DATA_SOURCE, StaleError, api } from "@/lib/api";
import { isOpenPattern, litIds, shortHeadline } from "@/lib/present";
import type { ConflictError, EvidenceRequest, EvidenceResult, Patient, ReviewRequest } from "@/lib/types";
import { describeError, useInvestigation, useWorkspace } from "@/lib/use-workspace";
import { cn } from "@/lib/utils";
import { GuideHint } from "./guide-hint";
import { InvestigationDrawer } from "./investigation-drawer";
import { MedicationRiver } from "./medication-river";
import type { SubmitOutcome } from "./next-question";
import { SandboxPanel } from "./sandbox-panel";
import { Wordmark } from "./site-header";
import { SourceList } from "./source-list";
import { LoadingState, NoMatchState, StaleState, UnavailableState } from "./state-notice";
import { StatusChip } from "./status";

export function Workspace({ pid }: { pid: string }) {
  const { timeline, findings, reload, version } = useWorkspace(pid);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [stale, setStale] = useState<ConflictError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [results, setResults] = useState<EvidenceResult[]>([]);
  // The last accepted change: its before/after card, and which findings' arcs re-draw.
  const [lastChange, setLastChange] = useState<EvidenceResult | null>(null);
  const changed = useMemo(
    () =>
      lastChange
        ? { ids: new Set(lastChange.new_revisions.map((r) => r.finding_id)), token: lastChange.event_id }
        : null,
    [lastChange],
  );
  const investigation = useInvestigation(selected, version);

  useEffect(() => {
    api.patients().then(setPatients, () => setPatients([]));
  }, [version]);

  const openFindings = useMemo(() => (findings.kind === "ready" ? findings.data.findings.filter(isOpenPattern) : []), [findings]);

  // Open the first finding on arrival, so the story is readable at a glance.
  useEffect(() => {
    if (!touched && selected === null && openFindings.length) setSelected(openFindings[0].id);
  }, [touched, selected, openFindings]);

  const select = useCallback((id: string | null) => {
    setTouched(true);
    setSelected(id);
  }, []);

  const lit = useMemo(() => {
    if (!selected || timeline.kind !== "ready" || findings.kind !== "ready") return null;
    const f = findings.data.findings.find((x) => x.id === selected);
    return f ? litIds(f, timeline.data) : null;
  }, [selected, timeline, findings]);

  const handleError = (err: unknown) => {
    if (err instanceof StaleError) setStale(err.conflict);
    else setActionError(describeError(err));
  };

  async function submitEvidence(req: EvidenceRequest): Promise<SubmitOutcome> {
    setActionError(null);
    try {
      const r = await api.submitEvidence(pid, req);
      setResults((prev) => [...prev.filter((x) => x.event_id !== r.event_id), r]);
      setLastChange(r);
      setStale(null);
      // Keep the drawer on a finding this change touched, so its before/after card has context.
      const touched = r.affected_finding_ids;
      if (touched.length && (!selected || !touched.includes(selected))) select(touched[0]);
      await reload();
      return "ok";
    } catch (err) {
      handleError(err);
      return err instanceof StaleError ? "stale" : "error";
    }
  }

  async function confirmEvidence(req: EvidenceRequest) {
    setBusyEvent(req.event_id);
    await submitEvidence(req);
    setBusyEvent(null);
  }

  async function resetSandbox() {
    setActionError(null);
    try {
      await api.reset();
      setResults([]);
      setLastChange(null);
      setStale(null);
      await reload();
    } catch (err) {
      handleError(err);
    }
  }

  async function review(fid: string, body: ReviewRequest) {
    setActionError(null);
    try {
      await api.review(fid, body);
      setStale(null);
      await reload();
      return true;
    } catch (err) {
      handleError(err);
      return false;
    }
  }

  const reloadCase = () => {
    setStale(null);
    setActionError(null);
    void reload();
  };

  const patient = timeline.kind === "ready" ? timeline.data.patient : patients.find((p) => p.id === pid);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ink">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Wordmark />
          <nav aria-label="Stories" className="flex items-center gap-1">
            <span className="smallcaps mr-1 text-ink-3">Story</span>
            {(patients.length ? patients : [{ id: pid } as Patient]).map((p, i) => (
              <Link
                key={p.id}
                href={`/patients/${p.id}`}
                aria-current={p.id === pid ? "page" : undefined}
                className={cn(
                  "tabular grid size-7 place-items-center rounded-full border font-mono text-[12px] transition-colors",
                  p.id === pid ? "border-ink bg-ink text-ivory" : "border-rule-strong text-ink-2 hover:border-ink hover:text-ink",
                )}
              >
                {i + 1}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mx-auto max-w-[1680px] px-4 pb-4 sm:px-6">
          <p className="smallcaps text-ink-3">Medication review · synthetic patient</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <h1 className="font-serif text-[34px] leading-none sm:text-[44px]">{patient?.label ?? pid}</h1>
            <dl className="tabular flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-ink-2">
              {patient && (
                <>
                  <div className="flex gap-1.5"><dt className="text-ink-3">age</dt><dd>{patient.age_band}</dd></div>
                  <div className="flex gap-1.5"><dt className="text-ink-3">as of</dt><dd>day {patient.as_of_day}</dd></div>
                  <div className="flex gap-1.5"><dt className="text-ink-3">case</dt><dd>v{patient.case_version}</dd></div>
                </>
              )}
              <div className="flex gap-1.5"><dt className="text-ink-3">data</dt><dd>{DATA_SOURCE}</dd></div>
              <div>
                <dt className="sr-only">packet</dt>
                <dd>
                  <Link
                    href={`/packet/${encodeURIComponent(pid)}`}
                    className="inline-flex items-center gap-1 text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
                  >
                    <FileText className="size-3" aria-hidden />
                    packet
                  </Link>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1680px] space-y-3 px-4 pt-4 empty:hidden sm:px-6">
        <AnimatePresence>
          {stale && (
            <motion.div key="stale" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <StaleState sent={stale.sent} current={stale.current} onReload={reloadCase} />
            </motion.div>
          )}
          {actionError && (
            <motion.p
              key="err"
              role="alert"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-[4px] border border-l-[3px] border-coral bg-coral-wash/60 px-4 py-2.5 text-[13px] text-ink"
            >
              That change was not saved. {actionError}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <GuideHint />

      {timeline.kind === "loading" && (
        <div className="mx-auto grid max-w-[1680px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-3">
          <LoadingState lines={5} />
          <LoadingState label="Drawing the river" lines={5} />
          <LoadingState label="Assembling the evidence" lines={5} />
        </div>
      )}

      {timeline.kind === "unavailable" && (
        <div className="mx-auto max-w-2xl px-4 py-10">
          <UnavailableState message={timeline.message} onRetry={reloadCase} />
        </div>
      )}

      {timeline.kind === "ready" && (
        <main
          className={cn(
            "mx-auto grid max-w-[1680px] grid-cols-1 [grid-template-areas:'river''drawer''sources']",
            "lg:grid-cols-[minmax(0,1fr)_400px] lg:[grid-template-areas:'river_drawer''sources_drawer']",
            "xl:grid-cols-[250px_minmax(0,1fr)_420px] xl:[grid-template-areas:'sources_river_drawer']",
          )}
        >
          <aside aria-label="Sources" className="border-t border-rule px-4 py-5 [grid-area:sources] sm:px-6 lg:border-r xl:border-t-0">
            <SourceList timeline={timeline.data} lit={lit} onConfirm={confirmEvidence} busyEventId={busyEvent} />
          </aside>

          <section aria-label="Medication river" className="min-w-0 px-4 py-5 [grid-area:river] sm:px-6 lg:border-r lg:border-rule">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-[26px] leading-none">Medication River</h2>
              <p className="text-[12px] text-ink-3">One lane per medicine. Arcs are possible patterns, not causes.</p>
            </div>

            {findings.kind === "loading" && <LoadingState label="Evaluating patterns" lines={1} className="mb-3" />}
            {findings.kind === "unavailable" && <UnavailableState className="mb-3" message={findings.message} onRetry={reloadCase} />}
            {findings.kind === "ready" && openFindings.length === 0 && <NoMatchState className="mb-3" />}

            {openFindings.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-2" aria-label="Findings">
                {openFindings.map((f) => (
                  <li key={f.id} className="min-w-0 max-w-full">
                    <button
                      onClick={() => select(selected === f.id ? null : f.id)}
                      aria-pressed={selected === f.id}
                      className={cn(
                        "flex max-w-full items-center gap-2 rounded-[6px] border px-3 py-1.5 text-left text-[12.5px] transition-colors",
                        selected === f.id ? "border-ink bg-paper text-ink" : "border-rule-strong text-ink-2 hover:border-ink",
                      )}
                    >
                      <StatusChip status={f.status} />
                      <span className="min-w-0 max-w-[46ch] truncate">{shortHeadline(f.headline)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="overflow-x-auto rounded-[8px] border border-rule-strong bg-paper [scrollbar-width:thin]">
              <MedicationRiver
                timeline={timeline.data}
                findings={openFindings}
                selectedId={selected}
                lit={lit}
                changed={changed}
                onSelect={select}
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-ink-3 sm:hidden">Swipe the river sideways to follow the story &rarr;</p>
            <Legend />
            <SandboxPanel timeline={timeline.data} onSubmit={submitEvidence} onReset={resetSandbox} />
          </section>

          <aside aria-label="Investigation" className="border-t border-rule px-4 py-5 [grid-area:drawer] sm:px-6 lg:border-t-0">
            <div className="lg:sticky lg:top-4">
              {findings.kind === "unavailable" ? (
                <UnavailableState message={findings.message} onRetry={reloadCase} />
              ) : findings.kind === "ready" && openFindings.length === 0 ? (
                <NoMatchState />
              ) : (
                <InvestigationDrawer
                  state={investigation}
                  timeline={timeline.data}
                  evidenceResults={results}
                  lastChange={lastChange}
                  stale={stale !== null}
                  onSubmitEvidence={submitEvidence}
                  onDismissChange={() => setLastChange(null)}
                  onReview={review}
                  onAgentRan={async () => {
                    setStale(null);
                    await reload();
                  }}
                  onError={handleError}
                  onRetry={reloadCase}
                />
              )}
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}

function Legend() {
  const item = "flex items-center gap-2";
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-ink-2" aria-label="Legend">
      <li className={item}>
        <svg width="26" height="8" aria-hidden><line x1="1" x2="25" y1="4" y2="4" stroke="var(--amber)" strokeWidth="2" /></svg>
        documented link
      </li>
      <li className={item}>
        <svg width="26" height="8" aria-hidden><line x1="1" x2="25" y1="4" y2="4" stroke="var(--amber)" strokeWidth="2" strokeDasharray="6 5" /></svg>
        unknown
      </li>
      <li className={item}>
        <span className="hatch-amber h-2 w-6 rounded-full border border-amber" aria-hidden />
        conflicting
      </li>
      <li className={item}>
        <span className="size-2 rounded-full bg-amber" aria-hidden /> possible pattern
      </li>
      <li className={item}>
        <span className="size-2 rounded-full bg-teal" aria-hidden /> reviewed
      </li>
      <li className={item}>
        <span className="size-2.5 rounded-full border border-ink bg-ink" aria-hidden /> documented
      </li>
      <li className={item}>
        <span className="size-2.5 rounded-full border border-ink" aria-hidden /> reported
      </li>
    </ul>
  );
}
