"use client";

// A row of dominoes tipping over, the first one amber. Loops gently; still for reduced motion.
import { motion, useReducedMotion } from "framer-motion";

const COUNT = 9;
const CYCLE = 6.4; // seconds
const START = 0.6;
const STEP = 0.16;
const FALL = 0.42;
const LEAN = 62; // degrees, resting on the next domino
const LAST = 84; // the last one falls almost flat

const PIPS: Array<Array<[number, number]>> = [
  [[50, 50]],
  [[30, 30], [70, 70]],
  [[30, 30], [50, 50], [70, 70]],
  [[30, 30], [70, 30], [30, 70], [70, 70]],
];

function Face({ pips }: { pips: Array<[number, number]> }) {
  return (
    <span className="relative block h-1/2 w-full">
      {pips.map(([x, y], i) => (
        <span
          key={i}
          className="absolute size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current sm:size-1"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      ))}
    </span>
  );
}

export function Dominoes({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <div className={className} aria-hidden>
      <div className="flex items-end gap-[clamp(12px,3.4vw,30px)] border-b border-ink pb-px">
        {Array.from({ length: COUNT }, (_, i) => {
          const first = i === 0;
          const angle = i === COUNT - 1 ? LAST : LEAN;
          const t0 = (START + i * STEP) / CYCLE;
          const t1 = (START + i * STEP + FALL) / CYCLE;
          return (
            <motion.div
              key={i}
              className={
                "relative flex h-[clamp(52px,11vw,92px)] w-[clamp(15px,3vw,24px)] flex-col rounded-[3px] border border-ink " +
                (first ? "bg-amber text-ink" : "bg-paper text-ink")
              }
              style={{ originX: 1, originY: 1 }}
              initial={{ rotate: reduced ? (first ? 14 : 0) : 0 }}
              animate={reduced ? undefined : { rotate: [0, 0, angle, angle, 0] }}
              transition={
                reduced
                  ? undefined
                  : {
                      duration: CYCLE,
                      times: [0, t0, t1, 0.88, 1],
                      ease: ["linear", [0.55, 0, 1, 0.45], "linear", [0.3, 0, 0.2, 1]],
                      repeat: Infinity,
                    }
              }
            >
              <Face pips={PIPS[i % 4]} />
              <span className="mx-[3px] h-px bg-current opacity-60" />
              <Face pips={PIPS[(i + 2) % 4]} />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
