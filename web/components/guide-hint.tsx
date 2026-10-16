"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "fd.guide.dismissed";

const STEPS = [
  "Click the amber arc to open the investigation.",
  "Answer the next question.",
  "Edit a fact in the sandbox and watch only the affected finding change.",
];

/** A first-visit hint for the workspace. Dismissal is remembered in this browser only. */
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
            <p className="smallcaps text-amber-ink">How to try this</p>
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
