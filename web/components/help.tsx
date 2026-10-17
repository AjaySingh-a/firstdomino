"use client";

// A (?) icon with a one-line explanation. Opens on hover, on keyboard focus and on tap.

import { HelpCircle } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export function Help({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label="What is this?"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="grid size-5 place-items-center rounded-full text-ink-3 transition-colors hover:text-ink"
      >
        <HelpCircle className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1 w-max max-w-[min(260px,70vw)] -translate-x-1/2 rounded-[4px] border border-ink bg-ink px-2.5 py-1.5 text-left font-sans text-[12px] font-normal normal-case leading-snug tracking-normal text-ivory shadow-sm"
        >
          {text}
        </span>
      )}
    </span>
  );
}
