"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Compass, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { startTour, tourHref } from "@/lib/tour";

const KEY = "fd.guide.dismissed";

const STEPS = [
  "Click the amber arc to see what is on record and what is missing.",
  "Answer the one missing fact.",
  "Edit a fact in the sandbox and watch only the findings that depend on it change.",
];

/** A first-visit hint for the workspace, with the way into the guided tour. Dismissal is remembered in this browser only. */
export function GuideHint() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, []);

  function dismiss() {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // storage blocked: the hint simply comes back next visit
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          aria-label="How to try this"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mx-auto max-w-[1680px] overflow-hidden px-4 pt-4 sm:px-6"
        >
          <div className="relative rounded-[6px] border border-l-[3px] border-amber bg-amber-wash/40 py-3 pl-4 pr-10">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="smallcaps text-amber-ink">How to try this</p>
              <Link
                href={tourHref(1)}
                onClick={startTour}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-ink px-3 py-1 text-[12px] font-medium text-ivory hover:bg-ink-2"
              >
                <Compass className="size-3.5" aria-hidden /> Take the 2-minute guided tour
              </Link>
            </div>
            <ol className="mt-1.5 grid gap-x-6 gap-y-1.5 text-[13px] text-ink md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s} className="flex gap-2">
                  <span className="tabular grid size-5 shrink-0 place-items-center rounded-full border border-amber-ink font-mono text-[11px] text-amber-ink">
                    {i + 1}
                  </span>
                  <span className="leading-snug">{s}</span>
                </li>
              ))}
            </ol>
            <button
              onClick={dismiss}
              aria-label="Dismiss the guide"
              className="absolute right-2 top-2 grid size-7 place-items-center rounded-full text-ink-3 transition-colors hover:bg-paper hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
