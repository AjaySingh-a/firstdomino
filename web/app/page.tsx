"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ChevronDown, Compass, FlaskConical } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChainAnimation } from "@/components/chain";
import { GraphMemory, ProofStrip, Tracks } from "@/components/landing-proof";
import { Accent, Reveal, ScrollProgress, SectionHead } from "@/components/reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useTourOffer, WelcomeCard } from "@/components/tour-offer";
import { LoadingState, UnavailableState } from "@/components/state-notice";
import { StatusChip } from "@/components/status";
import { api } from "@/lib/api";
import { STORY_TITLES, isStory } from "@/lib/present";
import { startTour, tourHref } from "@/lib/tour";
import type { Finding, Patient } from "@/lib/types";
import { cn } from "@/lib/utils";
import { describeError, type Loadable } from "@/lib/use-workspace";

type Story = { patient: Patient; findings: Finding[] };

/** One short line per story, with its key words in bold. Keyed by the synthetic patient. */
const SHOWS: Record<string, React.ReactNode> = {
  "syn-p1": (
    <>
      Furosemide followed ankle swelling. <b>Nobody wrote down why.</b>
    </>
  ),
  "syn-p2": (
    <>
      Same medicines, <b>another reason on record.</b>
    </>
  ),
  "syn-p3": (
    <>
      Reviewed, then <b>a late note moved a date.</b>
    </>
  ),
};

export default function Landing() {
  const [stories, setStories] = useState<Loadable<Story[]>>({
    kind: "loading",
  });
  const offer = useTourOffer();

  const load = () => {
    setStories({ kind: "loading" });
    api
      .patients()
      .then((ps) =>
        Promise.all(
          ps
            .filter((p) => isStory(p.id))
            .map(async (p) => ({
              patient: p,
              findings: (await api.findings(p.id)).findings,
            })),
        ),
      )
      .then(
        (data) => setStories({ kind: "ready", data }),
        (err) => setStories({ kind: "unavailable", message: describeError(err) }),
      );
  };
  useEffect(load, []);

  return (
    <>
      <ScrollProgress />
      <div className="wrap">
        <SiteHeader />
      </div>

      <main>
        <WelcomeCard open={offer.pending} onSkip={() => offer.choose("skipped")} />
        <Hero tourPulse={offer.pending} onLeave={() => offer.pending && offer.choose("skipped")} />
        <WhyGraph />
        <LabBand />
        <ProofStrip />
        <GraphMemory />

        <section id="stories" aria-labelledby="stories-h" className="scroll-mt-6 border-t border-ink py-20 sm:py-28">
          <div className="wrap">
            <SectionHead
              n="05"
              kicker="The stories"
              title={
                <span id="stories-h">
                  Three synthetic <Accent>stories</Accent>.
                </span>
              }
              note="For a pharmacist's medication review. The clinician decides."
            />

            {stories.kind === "loading" && <LoadingState className="mt-10 max-w-md" lines={3} />}
            {stories.kind === "unavailable" && <UnavailableState className="mt-10 max-w-xl" message={stories.message} onRetry={load} />}
            {stories.kind === "ready" && (
              <ol className="mt-12 grid gap-5 md:grid-cols-3">
                {stories.data.map(({ patient, findings }, i) => {
                  const f = findings[0];
                  return (
                    <Reveal as="li" key={patient.id} delay={i * 0.1}>
                      <Link
                        href={`/patients/${patient.id}`}
                        className="group flex h-full flex-col rounded-[12px] border border-ink bg-paper p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[6px_6px_0_var(--ink)]"
                      >
                        <p className="font-display text-[64px] font-extrabold leading-none tracking-[-0.04em] text-rule-strong transition-colors group-hover:text-amber">
                          0{i + 1}
                        </p>
                        <p className="mt-4 font-display text-[26px] font-bold leading-tight tracking-[-0.02em]">
                          {STORY_TITLES[patient.id] ?? patient.label}
                        </p>
                        {SHOWS[patient.id] && <p className="mt-2 text-[15px] leading-snug text-ink-2">{SHOWS[patient.id]}</p>}
                        <div className="mt-5">
                          {f ? <StatusChip status={f.status} /> : <span className="text-[13px] text-ink-3">No matched pattern.</span>}
                        </div>
                        <span className="mt-auto flex items-center gap-1.5 pt-6 text-[14px] font-semibold text-ink">
                          Open the review
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
                        </span>
                      </Link>
                    </Reveal>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
        <Tracks />
      </main>
      <SiteFooter className="mt-0" />
    </>
  );
}

const btn =
  "inline-flex h-12 items-center gap-2 rounded-full border px-6 text-[15px] font-semibold transition-[background-color,transform] hover:-translate-y-0.5";

/** The first screen fills the laptop: the headline, three ways in, and the chain. It drifts as you scroll. */
function Hero({ tourPulse, onLeave }: { tourPulse: boolean; onLeave: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const chainY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section ref={ref} className="relative flex min-h-[calc(100svh-74px)] items-center py-12">
      <div className="wrap grid items-center gap-12 lg:grid-cols-[1.5fr_1fr]">
        <motion.div style={{ y: textY, opacity: fade }}>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="smallcaps text-amber-ink">
            Find the first domino
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mt-4 font-display text-[clamp(40px,6.4vw,92px)] font-extrabold leading-[0.95] tracking-[-0.035em]"
          >
            A <Accent>side effect</Accent>, mistaken for a new illness, treated with <Accent>another medicine</Accent>.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="mt-6 max-w-[46ch] text-[18px] leading-relaxed text-ink-2 sm:text-[20px]"
          >
            FirstDomino finds that chain across visits and asks for <b className="mark font-semibold text-ink">the one missing fact</b>.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Link
              href={tourHref(1)}
              onClick={startTour}
              className={cn(btn, "border-ink bg-ink text-ivory hover:bg-ink-2", tourPulse && "fd-tour-pulse")}
            >
              <Compass className="size-4" aria-hidden /> Take the 2-minute guided tour
            </Link>
            <Link href="/lab" onClick={onLeave} className={cn(btn, "border-amber-ink bg-amber text-ink hover:bg-amber/80")}>
              <FlaskConical className="size-4" aria-hidden /> Build your own patient
            </Link>
            <a href="#stories" onClick={onLeave} className={cn(btn, "border-ink text-ink hover:bg-paper")}>
              The stories <ArrowRight className="size-4" aria-hidden />
            </a>
          </motion.div>
        </motion.div>
        <motion.div style={{ y: chainY }}>
          <ChainAnimation className="mx-auto w-full max-w-[560px] rounded-[16px] border border-ink bg-paper p-6 shadow-[8px_8px_0_var(--ink)]" />
        </motion.div>
      </div>
      <motion.a
        href="#why-h"
        style={{ opacity: fade }}
        aria-label="Scroll to the next section"
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-ink-3 sm:flex"
      >
        <span className="smallcaps">Scroll</span>
        <motion.span animate={{ y: [0, 6, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
          <ChevronDown className="size-5" aria-hidden />
        </motion.span>
      </motion.a>
    </section>
  );
}

/** Three numbers, each one a graph query. */
const WHY = [
  {
    n: "1",
    unit: "walk",
    q: "Q1",
    text: (
      <>
        Medicine → class → pattern → symptom → second medicine. <b>One traversal.</b>
      </>
    ),
  },
  {
    n: "1",
    unit: "question",
    q: "Q2",
    text: (
      <>
        The missing fact <b>most findings wait on</b>, and who can answer it.
      </>
    ),
  },
  {
    n: "0",
    unit: "re-checks",
    q: "Q3",
    text: (
      <>
        Change an unrelated medicine and <b>nothing reopens</b>.
      </>
    ),
  },
];

function WhyGraph() {
  return (
    <section aria-labelledby="why-h" className="scroll-mt-6 border-t border-ink py-20 sm:py-28">
      <div className="wrap">
        <SectionHead
          n="01"
          kicker="Why a graph"
          title={
            <span id="why-h">
              Every answer is <Accent>one graph query</Accent>.
            </span>
          }
        />
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {WHY.map((w, i) => (
            <Reveal
              as="li"
              key={w.q}
              delay={i * 0.12}
              className="group relative overflow-hidden rounded-[12px] border border-ink bg-paper p-7"
            >
              <span className="absolute right-5 top-5 rounded-full border border-ink px-2 py-0.5 font-mono text-[11px]">{w.q}</span>
              <p className="flex items-baseline gap-3">
                <span className="font-display text-[96px] font-extrabold leading-[0.85] tracking-[-0.05em] text-amber-ink transition-transform duration-300 group-hover:-translate-y-1">
                  {w.n}
                </span>
                <span className="font-serif text-[32px] italic text-ink">{w.unit}</span>
              </p>
              <p className="mt-6 text-[16px] leading-snug text-ink-2">{w.text}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

const LAB_STEPS = [
  { t: "Place medicines on a timeline", s: "and say who reported each one" },
  { t: "Write it to FalkorDB", s: "a new synthetic patient" },
  {
    t: "Watch the graph walk it",
    s: "same queries, same rules, in milliseconds",
  },
];

/** The lab, on a dark band: the visitor's own patient, evaluated live. */
function LabBand() {
  return (
    <section aria-labelledby="lab-h" className="bg-ink py-20 text-ivory sm:py-28">
      <div className="wrap grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <SectionHead
            dark
            n="02"
            kicker="Patient lab"
            title={
              <span id="lab-h">
                Don&rsquo;t take our word for it. <Accent className="text-amber">Build your own.</Accent>
              </span>
            }
          />
          <Reveal delay={0.15}>
            <p className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-ivory/75">
              Nothing is precomputed. <b className="text-ivory">Without FalkorDB, the lab has no answer at all.</b>
            </p>
            <Link href="/lab" className={cn(btn, "mt-8 border-amber bg-amber text-ink hover:bg-amber/85")}>
              <FlaskConical className="size-4" aria-hidden /> Open the patient lab
            </Link>
          </Reveal>
        </div>
        <ol className="grid gap-3">
          {LAB_STEPS.map((s, i) => (
            <Reveal
              as="li"
              key={s.t}
              delay={0.1 + i * 0.12}
              y={24}
              className="flex items-center gap-5 rounded-[12px] border border-ivory/20 bg-ivory/5 p-5"
            >
              <span className="font-display text-[44px] font-extrabold leading-none text-amber">{i + 1}</span>
              <span>
                <span className="block text-[18px] font-semibold">{s.t}</span>
                <span className="block text-[14px] text-ivory/60">{s.s}</span>
              </span>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
