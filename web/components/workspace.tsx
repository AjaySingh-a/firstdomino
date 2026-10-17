"use client";

import { AnimatePresence, motion } from "framer-motion";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DATA_SOURCE, StaleError, api } from "@/lib/api";
import { STORY_TITLES, isOpenPattern, litIds, shortHeadline } from "@/lib/present";
import { Tech, TechToggle } from "@/lib/tech";
import { TOUR_FINDINGS, type DrawerTab } from "@/lib/tour";
import type { ConflictError, EvidenceRequest, EvidenceResult, Patient, ReviewRequest } from "@/lib/types";
import { describeError, useInvestigation, useWorkspace } from "@/lib/use-workspace";
import { cn } from "@/lib/utils";
import { Help } from "./help";
import { InvestigationDrawer } from "./investigation-drawer";
import { MedicationRiver } from "./medication-river";
import type { SubmitOutcome } from "./next-question";
import { SandboxPanel } from "./sandbox-panel";
import { Wordmark } from "./site-header";
import { SourceList } from "./source-list";
import { LoadingState, NoMatchState, StaleState, UnavailableState } from "./state-notice";
import { StatusChip } from "./status";
import { TourProvider, useTour } from "./tour";
import { TourButton, TourOffer } from "./tour-offer";

export function Workspace({ pid }: { pid: string }) {
  return (
    <TourProvider pid={pid}>
      <WorkspaceView pid={pid} />
    </TourProvider>
  );
}

function WorkspaceView({ pid }: { pid: string }) {
  const { timeline, findings, reload, version } = useWorkspace(pid);
  const tour = useTour();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState<DrawerTab>("investigation");
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

  // Open the first finding on arrival, so the story is readable at a glance (the tour opens it itself).
  useEffect(() => {
    if (!tour.active && !touched && selected === null && openFindings.length) setSelected(openFindings[0].id);
  }, [tour.active, touched, selected, openFindings]);

  // The tour story was reset: forget this page's record of earlier changes and read it again.
  useEffect(() => {
    if (!tour.resetToken) return;
    setResults([]);
    setLastChange(null);
    setStale(null);
    void reload();
  }, [tour.resetToken, reload]);

  // Each tour step sets up what it talks about: the finding (or none yet) and the drawer tab.
  const step = tour.step;
  const tourFinding = TOUR_FINDINGS[pid as keyof typeof TOUR_FINDINGS];
  useEffect(() => {
    if (!step) return;
    setTouched(true);
    setSelected(step.select ? (tourFinding ?? null) : null);
  }, [step, tourFinding]);
  const stepTab = step ? (tour.done && step.done?.tab) || step.tab : undefined;
  useEffect(() => {
    if (stepTab) setTab(stepTab);
  }, [stepTab, tour.n]);

  const select = useCallback(
    (id: string | null) => {
      setTouched(true);
      setSelected(id);
      if (id) tour.emit("finding-selected", id);
    },
    [tour],
  );

  const lit = useMemo(() => {
    if (step?.beats) return new Set(step.beats.slice(0, tour.beat).map((b) => b.id));
    if (!selected || timeline.kind !== "ready" || findings.kind !== "ready") return null;
    const f = findings.data.findings.find((x) => x.id === selected);
    return f ? litIds(f, timeline.data) : null;
  }, [step, tour.beat, selected, timeline, findings]);

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
      if (touched.length && (!selected || !touched.includes(selected))) {
        setTouched(true);
        setSelected(touched[0]);
      }
      await reload();
      tour.emit("evidence-recorded", r);
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
  const storyNo = patients.findIndex((p) => p.id === pid) + 1;

  return (
    <div className={cn("min-h-dvh", tour.active && "pb-[52dvh] lg:pb-0 lg:pr-[360px]")}>
      <header className="border-b border-ink">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Wordmark />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <TourButton onRestart={tour.active ? tour.restart : undefined} />
            <Link href="/how-it-works" className="text-[12.5px] text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink">
              How it works
            </Link>
            <nav aria-label="Stories" className="flex items-center gap-1">
              <span className="smallcaps mr-1 text-ink-3">Story</span>
              {(patients.length ? patients : [{ id: pid } as Patient]).map((p, i) => (
                <Link
                  key={p.id}
                  href={`/patients/${p.id}`}
                  aria-current={p.id === pid ? "page" : undefined}
                  title={STORY_TITLES[p.id]}
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
        </div>
        <div className="mx-auto max-w-[1680px] px-4 pb-4 sm:px-6">
          <p className="smallcaps text-ink-3">
            Medication review · synthetic patient{patient ? ` · age ${patient.age_band}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <h1 className="font-serif text-[34px] leading-none sm:text-[44px]">
              {storyNo > 0 && STORY_TITLES[pid] ? (
                <>
                  <span className="text-ink-3">Story {storyNo} · </span>
                  {STORY_TITLES[pid]}
                </>
              ) : (
                (patient?.label ?? pid)
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Tech>
                <dl className="tabular flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-ink-2">
                  <div className="flex gap-1.5"><dt className="text-ink-3">patient</dt><dd>{pid}</dd></div>
                  {patient && (
                    <>
                      <div className="flex gap-1.5"><dt className="text-ink-3">as of</dt><dd>day {patient.as_of_day}</dd></div>
                      <div className="flex gap-1.5"><dt className="text-ink-3">case</dt><dd>v{patient.case_version}</dd></div>
                    </>
                  )}
                  <div className="flex gap-1.5"><dt className="text-ink-3">data</dt><dd>{DATA_SOURCE}</dd></div>
                </dl>
              </Tech>
              <Link
                href={`/packet/${encodeURIComponent(pid)}`}
                className="inline-flex items-center gap-1 text-[12.5px] text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
              >
                <FileText className="size-3.5" aria-hidden />
                Review packet
              </Link>
              <TechToggle />
            </div>
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

      <TourOffer tourActive={tour.active} />

      {timeline.kind === "loading" && (
        <div className="mx-auto grid max-w-[1680px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-3">
          <LoadingState lines={5} />
          <LoadingState label="Drawing the timeline" lines={5} />
          <LoadingState label="Assembling the evidence" lines={5} />
        </div>
      )}

      {timeline.kind === "unavailable" && (
        <div className="mx-auto max-w-2xl px-4 py-10">
          <UnavailableState message={timeline.message} onRetry={reloadCase} />
        </div>
      )}

      {timeline.kind === "ready" && (
        // Container queries, not viewport ones: with the tour's coach open the page is narrower.
        <div className="@container">
          <main
            className={cn(
              "mx-auto grid max-w-[1680px] grid-cols-1 [grid-template-areas:'river''drawer''sources']",
              "@5xl:grid-cols-[minmax(0,1fr)_400px] @5xl:[grid-template-areas:'river_drawer''sources_drawer']",
              "@7xl:grid-cols-[250px_minmax(0,1fr)_420px] @7xl:[grid-template-areas:'sources_river_drawer']",
            )}
          >
            <aside aria-label="Sources" className="border-t border-rule px-4 py-5 [grid-area:sources] sm:px-6 @5xl:border-r @7xl:border-t-0">
              <SourceList timeline={timeline.data} lit={lit} onConfirm={confirmEvidence} busyEventId={busyEvent} />
            </aside>

            <section aria-label="Medication timeline" className="min-w-0 px-4 py-5 [grid-area:river] sm:px-6 @5xl:border-r @5xl:border-rule">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div>
                  <h2 className="flex items-center gap-1 font-serif text-[26px] leading-none">
                    Medication timeline
                    <Help text="Each line is a medicine, from the day it was started. Diamonds are symptoms. Amber arcs are possible patterns, never causes." />
                  </h2>
                  <p className="mt-1 text-[12px] text-ink-3">One line per medicine. Arcs are possible patterns, not causes.</p>
                </div>
                <LinkLegend />
              </div>

              {findings.kind === "loading" && <LoadingState label="Checking the patterns" lines={1} className="mb-3" />}
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

              <div data-tour="river" className="overflow-x-auto rounded-[8px] border border-rule-strong bg-paper [scrollbar-width:thin]">
                <MedicationRiver
                  timeline={timeline.data}
                  findings={openFindings}
                  selectedId={selected}
                  lit={lit}
                  changed={changed}
                  onSelect={select}
                  tourFindingId={tour.active ? tourFinding : undefined}
                  quietArcs={!!step?.quietArcs}
                />
              </div>
              <p className="mt-1.5 text-[11.5px] text-ink-3 sm:hidden">Swipe the timeline sideways to follow the story &rarr;</p>
              <Legend />
              <SandboxPanel timeline={timeline.data} onSubmit={submitEvidence} onReset={resetSandbox} preset={step?.sandbox} />
            </section>

            <aside aria-label="Investigation" data-tour="drawer" className="border-t border-rule px-4 py-5 [grid-area:drawer] sm:px-6 @5xl:border-t-0">
              <div className="@5xl:sticky @5xl:top-4">
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
                    tab={tab}
                    onTabChange={setTab}
                    suggestions={step?.suggestions}
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
        </div>
      )}
    </div>
  );
}

/** Always next to the timeline: what a line's style says about the evidence behind it. */
function LinkLegend() {
  const item = "flex items-center gap-1.5 whitespace-nowrap";
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 rounded-[6px] border border-rule bg-paper px-2.5 py-1.5 text-[11.5px] text-ink-2" aria-label="How to read the lines">
      <li className={item}>
        <svg width="24" height="8" aria-hidden><line x1="1" x2="23" y1="4" y2="4" stroke="var(--amber)" strokeWidth="2" /></svg>
        solid = on record
      </li>
      <li className={item}>
        <svg width="24" height="8" aria-hidden><line x1="1" x2="23" y1="4" y2="4" stroke="var(--amber)" strokeWidth="2" strokeDasharray="5 4" /></svg>
        dashed = not known yet
      </li>
      <li className={item}>
        <span className="hatch-amber h-2 w-6 rounded-full border border-amber" aria-hidden />
        hatched = records disagree
      </li>
    </ul>
  );
}

function Legend() {
  const item = "flex items-center gap-2";
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-ink-2" aria-label="Legend">
      <li className={item}>
        <span className="size-2 rounded-full bg-amber" aria-hidden /> possible pattern
      </li>
      <li className={item}>
        <span className="size-2 rounded-full bg-teal" aria-hidden /> reviewed by a clinician
      </li>
      <li className={item}>
        <span className="size-2.5 rounded-full border border-ink bg-ink" aria-hidden /> on record
      </li>
      <li className={item}>
        <span className="size-2.5 rounded-full border border-ink" aria-hidden /> reported by the caregiver
      </li>
      <li className={item}>
        <span className="size-2.5 rounded-full border border-dashed border-ink-3" aria-hidden /> not known yet
      </li>
    </ul>
  );
}
