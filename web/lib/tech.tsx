"use client";

// "Show technical details": raw IDs, status codes, tool and query names, case versions. Hidden by
// default so a first-time visitor reads plain sentences; one switch shows them all for judges who want
// them. Remembered in this browser only.

import { Code2 } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { cn } from "./utils";

const KEY = "fd.tech";

const TechContext = createContext<{ on: boolean; toggle: () => void }>({ on: false, toggle: () => {} });

export function TechProvider({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      setOn(localStorage.getItem(KEY) === "1");
    } catch {
      // storage blocked: details start hidden
    }
  }, []);

  const toggle = useCallback(() => {
    setOn((v) => {
      try {
        localStorage.setItem(KEY, v ? "0" : "1");
      } catch {
        // storage blocked: the choice lasts until the page reloads
      }
      return !v;
    });
  }, []);

  return <TechContext.Provider value={{ on, toggle }}>{children}</TechContext.Provider>;
}

export const useTech = () => useContext(TechContext).on;

/** Renders its children only while technical details are shown. */
export function Tech({ children }: { children: React.ReactNode }) {
  return useTech() ? <>{children}</> : null;
}

export function TechToggle({ className }: { className?: string }) {
  const { on, toggle } = useContext(TechContext);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
        on ? "border-ink bg-ink text-ivory" : "border-rule-strong text-ink-2 hover:border-ink hover:text-ink",
        className,
      )}
    >
      <Code2 className="size-3.5" aria-hidden />
      {on ? "Hide technical details" : "Show technical details"}
    </button>
  );
}
