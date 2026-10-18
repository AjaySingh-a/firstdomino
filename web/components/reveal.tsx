"use client";

// Scroll motion for the landing: things rise in when they enter the screen and sink back out when they
// leave it, so the page moves when the visitor scrolls down and again when they scroll back up.
// MotionConfig (providers.tsx) turns all of this into still pictures under reduced motion.

import { motion, useScroll, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

export function Reveal({
  children,
  className,
  delay = 0,
  y = 36,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "li" | "section";
}) {
  const M = as === "li" ? motion.li : as === "section" ? motion.section : motion.div;
  return (
    <M
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, amount: 0.25 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </M>
  );
}

/** The serif italic accent used inside bold display headlines. */
export function Accent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <em className={cn("font-serif font-normal italic tracking-normal text-amber-ink", className)}>{children}</em>;
}

/** A section heading: a numbered running head and a bold display line. */
export function SectionHead({
  n,
  kicker,
  title,
  note,
  dark,
}: {
  n: string;
  kicker: string;
  title: React.ReactNode;
  note?: string;
  dark?: boolean;
}) {
  return (
    <Reveal className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div>
        <p className={cn("smallcaps flex items-center gap-3", dark ? "text-amber" : "text-amber-ink")}>
          <span className="font-mono">{n}</span>
          <span aria-hidden className={cn("h-px w-8", dark ? "bg-amber" : "bg-amber-ink")} />
          {kicker}
        </p>
        <h2 className="mt-3 max-w-[22ch] font-display text-[clamp(30px,4vw,52px)] font-bold leading-[1.02] tracking-[-0.025em]">{title}</h2>
      </div>
      {note && <p className={cn("max-w-[34ch] text-[14px] leading-snug", dark ? "text-ivory/70" : "text-ink-3")}>{note}</p>}
    </Reveal>
  );
}

/** A thin amber bar at the top of the screen that fills as the visitor scrolls. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 26,
    mass: 0.3,
  });
  return <motion.div aria-hidden style={{ scaleX }} className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-amber print:hidden" />;
}
