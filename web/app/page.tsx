"use client";

import { motion } from "framer-motion";
import { ArrowRight, Compass } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChainAnimation, HowItWorksStrip } from "@/components/chain";
import { Wordmark } from "@/components/site-header";
import { LoadingState, UnavailableState } from "@/components/state-notice";
import { StatusChip } from "@/components/status";
import { api } from "@/lib/api";
import { STATUS, STORY_TITLES } from "@/lib/present";
import { clearTourRun, tourHref } from "@/lib/tour";
import type { Finding, Patient } from "@/lib/types";
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

  const load = () => {
    setStories({ kind: "loading" });
    api
      .patients()
      .then((ps) => Promise.all(ps.map(async (p) => ({ patient: p, findings: (await api.findings(p.id)).findings }))))
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
          <Link href="/how-it-works" className="text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink">
            How it works
          </Link>
          <span className="smallcaps hidden text-ink-3 sm:inline">Synthetic data · Graph Hacks 2026</span>
        </nav>
      </header>

      <main className="flex-1">
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
              FirstDomino finds these possible chains and asks for the one missing fact a clinician needs.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="mt-7 flex flex-wrap items-center gap-3"
            >
              <Link
                href={tourHref(1)}
                onClick={clearTourRun}
                className="inline-flex h-11 items-center gap-2 rounded-[6px] border border-ink bg-ink px-5 text-[15px] font-medium text-ivory transition-colors hover:bg-ink-2"
              >
                <Compass className="size-4" aria-hidden /> Take the 2-minute guided tour
              </Link>
              <a
                href="#stories"
                className="inline-flex h-11 items-center gap-2 rounded-[6px] border border-ink px-5 text-[15px] font-medium text-ink transition-colors hover:bg-paper"
              >
                Explore on your own <ArrowRight className="size-4" aria-hidden />
              </a>
            </motion.div>
          </div>
          <ChainAnimation className="mx-auto w-full max-w-[460px] rounded-[10px] border border-rule-strong bg-paper p-4" />
        </section>

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
