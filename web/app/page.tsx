"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Dominoes } from "@/components/dominoes";
import { Wordmark } from "@/components/site-header";
import { LoadingState, UnavailableState } from "@/components/state-notice";
import { StatusChip } from "@/components/status";
import { api } from "@/lib/api";
import { STATUS, shortHeadline } from "@/lib/present";
import type { Finding, Patient } from "@/lib/types";
import { describeError, type Loadable } from "@/lib/use-workspace";

type Story = { patient: Patient; findings: Finding[] };

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
      <header className="flex items-center justify-between border-b border-ink py-4">
        <Wordmark />
        <span className="smallcaps text-ink-3">Synthetic data · Graph Hacks 2026</span>
      </header>

      <main className="flex-1">
        <section className="grid gap-10 py-12 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="font-serif text-[clamp(52px,10vw,112px)] leading-[0.92] tracking-[-0.01em]"
            >
              Find the first <em className="text-amber-ink">domino.</em>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="mt-6 max-w-[52ch] text-[16px] leading-relaxed text-ink-2"
            >
              Sometimes a side effect of one medicine is read as a new condition and treated with another.
              FirstDomino reconstructs a medication story across visits, finds <em>possible</em> prescribing
              cascades from a few curated, cited patterns, and asks for the evidence a clinician needs to
              review them.
            </motion.p>
          </div>
          <Dominoes className="pb-2 lg:pb-6" />
        </section>

        <section aria-labelledby="stories-h" className="border-t border-ink pb-16 pt-6">
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
                      <p className="font-mono text-[11px] text-ink-3">
                        No. {i + 1} · {patient.id} · age {patient.age_band}
                      </p>
                      <p className="mt-2 font-serif text-[26px] leading-tight">{patient.label}</p>
                      {f ? (
                        <>
                          <p className="mt-2 text-[13.5px] leading-snug text-ink-2">
                            {shortHeadline(f.headline)}
                          </p>
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
        <Link href="/states" className="underline decoration-rule-strong underline-offset-2 hover:text-ink">
          Interface states
        </Link>
      </footer>
    </div>
  );
}
