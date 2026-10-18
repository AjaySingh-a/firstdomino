"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Compass, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { rememberTourChoice, startTour, takeBannerTurn, tourChoice, tourHref, type TourChoice } from "@/lib/tour";
import { cn } from "@/lib/utils";
import { GuideHint } from "./guide-hint";

/** The header's way back into the tour, on every page. In a running tour it restarts that run instead. */
export function TourButton({ onRestart, className }: { onRestart?: () => void; className?: string }) {
  return (
    <Link
      href={tourHref(1)}
      onClick={(e) => {
        startTour();
        if (onRestart) {
          e.preventDefault();
          onRestart();
        }
      }}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-ink px-3 text-[12.5px] font-medium text-ink transition-colors hover:bg-ink hover:text-ivory",
        className,
      )}
    >
      <Compass className="size-3.5" aria-hidden /> Guided tour
    </Link>
  );
}

/** Whether this visitor has yet to start or skip the tour. False until read, so nothing flashes on load. */
export function useTourOffer() {
  const [pending, setPending] = useState(false);
  useEffect(() => setPending(tourChoice() === null), []);
  return {
    pending,
    choose: (choice: TourChoice) => {
      rememberTourChoice(choice);
      setPending(false);
    },
  };
}

/** The landing page's first-visit card: the tour offered, never forced. */
export function WelcomeCard({ open, onSkip }: { open: boolean; onSkip: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          aria-labelledby="welcome-h"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.35, delay: 0.4 }}
          className="fixed inset-x-4 bottom-4 z-50 rounded-[8px] border border-l-[3px] border-amber bg-[color-mix(in_srgb,var(--amber-wash)_45%,var(--paper))] px-4 py-3 sm:px-5 sm:py-4 shadow-[0_10px_30px_-12px_rgba(31,26,20,0.45)] sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-[440px]"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div>
              <p className="smallcaps text-amber-ink">New here?</p>
              <p id="welcome-h" className="mt-0.5 font-serif text-[24px] leading-tight">
                Take the 2-minute guided tour
              </p>
              <p className="mt-1 hidden max-w-[56ch] text-[13.5px] leading-snug text-ink-2 sm:block">
                It walks through one synthetic story: the possible pattern, the missing fact, and what the clinician
                reviews.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={tourHref(1)}
                onClick={startTour}
                className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-ink bg-ink px-3 text-[13px] sm:h-10 sm:px-4 sm:text-[14px] font-medium text-ivory transition-colors hover:bg-ink-2"
              >
                <Compass className="size-4" aria-hidden /> Start the tour
              </Link>
              <button
                type="button"
                onClick={onSkip}
                className="inline-flex h-9 items-center rounded-[6px] border border-ink px-3 text-[13px] sm:h-10 sm:px-4 sm:text-[14px] font-medium text-ink transition-colors hover:bg-paper"
              >
                Explore on my own
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/**
 * The story page's offer for someone who arrived without the tour (a shared link): a small banner, once
 * per browser; on later visits, the usual how-to-try hint. Inside the tour it only records that the tour started.
 */
export function TourOffer({ tourActive }: { tourActive: boolean }) {
  const [mode, setMode] = useState<"deciding" | "banner" | "hint" | "hidden">("deciding");
  const decided = useRef(false);

  useEffect(() => {
    if (tourActive) {
      if (tourChoice() === null) rememberTourChoice("started");
      return;
    }
    // Decide once per mount: the banner's turn is taken on the first read.
    if (decided.current) return;
    decided.current = true;
    setMode(tourChoice() === null && takeBannerTurn() ? "banner" : "hint");
  }, [tourActive]);

  if (tourActive || mode === "deciding" || mode === "hidden") return null;
  if (mode === "hint") return <GuideHint />;
  return (
    <div className="mx-auto max-w-[1680px] px-4 pt-4 sm:px-6">
      <div role="note" className="flex items-center gap-3 rounded-[6px] border border-amber bg-amber-wash/50 py-2 pl-3 pr-1.5 text-[13.5px]">
        <Compass className="size-4 shrink-0 text-amber-ink" aria-hidden />
        <p className="min-w-0 flex-1 leading-snug">
          First time here?{" "}
          <Link href={tourHref(1)} onClick={startTour} className="font-medium underline decoration-amber-ink underline-offset-2 hover:decoration-ink">
            Take the 2-minute guided tour
          </Link>
        </p>
        <button
          type="button"
          onClick={() => {
            rememberTourChoice("skipped");
            setMode("hidden");
          }}
          aria-label="Dismiss"
          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-paper hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
