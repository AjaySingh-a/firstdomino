"use client";

import { motion } from "framer-motion";
import { ArrowRight, Compass, FlaskConical } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChainAnimation, HowItWorksStrip } from "@/components/chain";
import { Wordmark } from "@/components/site-header";
import { TourButton, useTourOffer, WelcomeCard } from "@/components/tour-offer";
import { LoadingState, UnavailableState } from "@/components/state-notice";
import { StatusChip } from "@/components/status";
import { api } from "@/lib/api";
import { STATUS, STORY_TITLES, isStory } from "@/lib/present";
import { startTour, tourHref } from "@/lib/tour";
import type { Finding, Patient } from "@/lib/types";
import { cn } from "@/lib/utils";
import { describeError, type Loadable } from "@/lib/use-workspace";

type Story = { patient: Patient; findings: Finding[] };

/** One plain sentence per story, for a first-time visitor. Keyed by the synthetic patient. */
const SHOWS: Record<string, string> = {
  "syn-p1": "Furosemide was started after ankle swelling, but nobody wrote down why. FirstDomino asks.",
  "syn-p2": "Same medicines, but the hospital recorded another reason for furosemide. Both are shown side by side.",
  "syn-p3": "A clinician already reviewed it, then a late GP note changed a date. The review needs a fresh look.",
};

export default function Landing() {
  const [stories, setStories] = useState<Loadable<Story[]>>({ kind: "loading" });
  const offer = useTourOffer();

  const load = () => {
    setStories({ kind: "loading" });
    api
      .patients()
      .then((ps) => Promise.all(ps.filter((p) => isStory(p.id)).map(async (p) => ({ patient: p, findings: (await api.findings(p.id)).findings }))))
      .then(
        (data) => setStories({ kind: "ready", data }),
        (err) => setStories({ kind: "unavailable", message: describeError(err) }),
      );
  };
  useEffect(load, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink py-4">
        <Wordmark />
        <nav className="flex items-center gap-4 text-[12.5px]">
          <TourButton />
          <Link href="/lab" className="font-medium text-amber-ink underline decoration-amber underline-offset-2 hover:text-ink">
            Patient lab
          </Link>
          <Link href="/how-it-works" className="text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink">
            How it works
          </Link>
          <span className="smallcaps hidden text-ink-3 sm:inline">Synthetic data · Graph Hacks 2026</span>
        </nav>
      </header>

      <main className="flex-1">
        <WelcomeCard open={offer.pending} onSkip={() => offer.choose("skipped")} />
        <section className="grid gap-8 py-10 sm:py-16 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <p className="smallcaps text-amber-ink">Find the first domino</p>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mt-3 font-serif text-[clamp(32px,5.2vw,56px)] leading-[1.04] tracking-[-0.01em]"
            >
              Sometimes a <em className="text-amber-ink">side effect</em> of one medicine is mistaken for a new illness and
              treated with <em className="text-amber-ink">another medicine</em>.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-ink-2"
            >
              FirstDomino finds these chains across visits and asks for the one fact a clinician still needs.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="mt-7 flex flex-wrap items-center gap-3"
            >
              <Link
                href={tourHref(1)}
                onClick={startTour}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-[6px] border border-ink bg-ink px-5 text-[15px] font-medium text-ivory transition-colors hover:bg-ink-2",
                  offer.pending && "fd-tour-pulse",
                )}
              >
                <Compass className="size-4" aria-hidden /> Take the 2-minute guided tour
              </Link>
              <Link
                href="/lab"
                onClick={() => offer.pending && offer.choose("skipped")}
                className="inline-flex h-11 items-center gap-2 rounded-[6px] border border-amber-ink bg-amber-wash px-5 text-[15px] font-medium text-ink transition-colors hover:bg-amber/40"
              >
                <FlaskConical className="size-4" aria-hidden /> Build your own patient
              </Link>
              <a
                href="#stories"
                onClick={() => offer.pending && offer.choose("skipped")}
                className="inline-flex h-11 items-center gap-2 rounded-[6px] border border-ink px-5 text-[15px] font-medium text-ink transition-colors hover:bg-paper"
              >
                The stories <ArrowRight className="size-4" aria-hidden />
              </a>
            </motion.div>
          </div>
          <ChainAnimation className="mx-auto w-full max-w-[460px] rounded-[10px] border border-rule-strong bg-paper p-4" />
        </section>

        <WhyGraph />

        <section aria-labelledby="how-h" className="border-t border-ink py-8">
          <h2 id="how-h" className="font-serif text-[30px]">How a chain happens</h2>
          <div className="mt-4">
            <HowItWorksStrip />
          </div>
        </section>

        <section id="stories" aria-labelledby="stories-h" className="scroll-mt-6 border-t border-ink pb-16 pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="stories-h" className="font-serif text-[30px]">Three synthetic stories</h2>
            <p className="text-[13px] text-ink-3">For a pharmacist&rsquo;s medication review. The clinician decides.</p>
          </div>

          {stories.kind === "loading" && <LoadingState className="mt-6 max-w-md" lines={3} />}
          {stories.kind === "unavailable" && <UnavailableState className="mt-6 max-w-xl" message={stories.message} onRetry={load} />}
          {stories.kind === "ready" && (
            <ol className="mt-6 grid gap-px overflow-hidden rounded-[8px] border border-ink bg-ink md:grid-cols-3">
              {stories.data.map(({ patient, findings }, i) => {
                const f = findings[0];
                return (
                  <motion.li
                    key={patient.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.08 }}
                    className="bg-ivory"
                  >
                    <Link href={`/patients/${patient.id}`} className="group flex h-full flex-col p-5 transition-colors hover:bg-paper">
                      <p className="smallcaps text-ink-3">Story {i + 1}</p>
                      <p className="mt-1 font-serif text-[26px] leading-tight">{STORY_TITLES[patient.id] ?? patient.label}</p>
                      {SHOWS[patient.id] && <p className="mt-2 text-[14px] leading-snug text-ink">{SHOWS[patient.id]}</p>}
                      {f ? (
                        <>
                          <div className="mt-4">
                            <StatusChip status={f.status} />
                          </div>
                          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{STATUS[f.status].blurb}</p>
                        </>
                      ) : (
                        <p className="mt-2 text-[13px] text-ink-3">No matched pattern.</p>
                      )}
                      <span className="mt-auto flex items-center gap-1.5 pt-5 text-[13px] font-medium text-ink">
                        Open the review
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" aria-hidden />
                      </span>
                    </Link>
                  </motion.li>
                );
              })}
            </ol>
          )}
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-rule py-5 text-[12px] text-ink-3">
        <p>All patients are synthetic. Findings are possible patterns for a clinician to review, never conclusions.</p>
        <div className="flex gap-4">
          <Link href="/how-it-works" className="underline decoration-rule-strong underline-offset-2 hover:text-ink">
            How it works
          </Link>
          <Link href="/states" className="underline decoration-rule-strong underline-offset-2 hover:text-ink">
            Interface states
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** Three numbers, each one a graph query. They appear as the visitor scrolls. */
const WHY = [
  { n: "1 walk", q: "Q1", text: "Medicine → class → pattern → symptom → second medicine. One traversal from the patient." },
  { n: "1 question", q: "Q2", text: "The missing fact the most open findings wait on, and who can answer it." },
  { n: "0 re-checks", q: "Q3", text: "Change a medicine no pattern uses and nothing reopens. Only linked findings move." },
];

function WhyGraph() {
  return (
    <section aria-labelledby="why-h" className="border-t border-ink py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="why-h" className="font-serif text-[30px]">Why it needs a graph</h2>
        <p className="text-[13px] text-ink-3">Without FalkorDB the lab answers 503. There is no fallback.</p>
      </div>
      <ol className="mt-5 grid gap-px overflow-hidden rounded-[8px] border border-ink bg-ink md:grid-cols-3">
        {WHY.map((w, i) => (
          <motion.li
            key={w.q}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: i * 0.12, duration: 0.45 }}
            className="bg-ivory p-5"
          >
            <p className="flex items-baseline justify-between">
              <span className="font-serif text-[38px] leading-none text-amber-ink">{w.n}</span>
              <span className="font-mono text-[11px] text-ink-3">{w.q}</span>
            </p>
            <p className="mt-3 text-[14px] leading-snug text-ink-2">{w.text}</p>
          </motion.li>
        ))}
      </ol>
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-amber-ink bg-amber-wash/50 px-5 py-4"
      >
        <p className="font-serif text-[22px] leading-tight">Don&rsquo;t take our three stories on trust. Build your own.</p>
        <Link href="/lab" className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-ink bg-ink px-4 text-[14px] font-medium text-ivory hover:bg-ink-2">
          <FlaskConical className="size-4" aria-hidden /> Open the patient lab
        </Link>
      </motion.div>
    </section>
  );
}
