"use client";

// The guided tour's runtime: the step from the URL, the per-story reset, the coach panel and the
// spotlight. Components report what the visitor did with `emit`; the step that waits for that event
// completes. Next always works too.
//   coach      side panel on desktop (the page makes room for it), bottom sheet on small screens
//   spotlight  dims everything but the step's element; clicks still reach the whole page
//   hotspot    a pulsing ring on the thing to click

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, ChevronDown, FileText, MousePointerClick, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  TOUR_ID,
  TOUR_LENGTH,
  TOUR_STEPS,
  clearTourRun,
  markReset,
  resetStories,
  textOf,
  tourHref,
  type TourEvent,
  type TourMemory,
  type TourStep,
} from "@/lib/tour";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

interface TourApi {
  active: boolean;
  n: number;
  step: TourStep | null;
  done: boolean;
  /** How many of the step's beats are revealed. */
  beat: number;
  memory: TourMemory;
  /** False while the story is being reset for the tour. */
  ready: boolean;
  /** Goes up after each reset, so the workspace reloads. */
  resetToken: number;
  emit: (event: TourEvent, payload?: unknown) => void;
  /** Back to step 1 with a fresh run. */
  restart: () => void;
}

const INACTIVE: TourApi = {
  active: false,
  n: 0,
  step: null,
  done: false,
  beat: 0,
  memory: {},
  ready: true,
  resetToken: 0,
  emit: () => {},
  restart: () => {},
};

const TourContext = createContext<TourApi>(INACTIVE);
export const useTour = () => useContext(TourContext);

const BEAT_MS = 1300;

export function TourProvider({ pid, children }: { pid: string; children: React.ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const active = params.get("tour") === TOUR_ID;
  const n = Math.min(TOUR_LENGTH, Math.max(1, Math.round(Number(params.get("step")) || 1)));
  const step = active ? TOUR_STEPS[n - 1] : null;
  const here = step?.story === pid;

  const [done, setDone] = useState(false);
  const [memory, setMemory] = useState<TourMemory>({});
  const [beat, setBeat] = useState(0);
  // While the tour resets this story the workspace waits, so it never reads a half-reset story.
  // Starts false whenever the tour is on this story (server and client agree); the effect below decides.
  const [ready, setReady] = useState(!(active && here));
  const [resetToken, setResetToken] = useState(0);

  const go = useCallback((m: number) => router.replace(tourHref(m), { scroll: false }), [router]);
  const skip = useCallback(() => {
    clearTourRun();
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);
  const restart = useCallback(() => {
    clearTourRun();
    setMemory({});
    router.replace(tourHref(1), { scroll: false });
  }, [router]);

  // A step for the other story: go there (its page then resets it if needed).
  useEffect(() => {
    if (step && !here) router.replace(tourHref(n), { scroll: false });
  }, [step, here, n, router]);

  // Reset only the story this part of the tour uses, once per tour run.
  useEffect(() => {
    if (!active || !here) {
      setReady(true);
      return;
    }
    if (resetStories().includes(pid)) {
      setReady(true);
      return;
    }
    let live = true;
    setReady(false);
    const finish = () => {
      if (!live) return;
      markReset(pid);
      setReady(true);
      setResetToken((t) => t + 1);
    };
    api.reset(pid).then(finish, finish); // a failed reset still lets the tour run on the current state
    return () => {
      live = false;
    };
  }, [active, here, pid]);

  useEffect(() => {
    setDone(false);
    setBeat(0);
  }, [n]);

  const beats = step?.beats?.length ?? 0;
  useEffect(() => {
    if (!beats || !ready || beat >= beats) return;
    const t = setTimeout(() => setBeat((b) => b + 1), beat === 0 ? 500 : BEAT_MS);
    return () => clearTimeout(t);
  }, [beat, beats, ready]);

  const emit = useCallback(
    (event: TourEvent, payload?: unknown) => {
      if (event === "evidence-recorded") setMemory((m) => ({ ...m, change: payload as TourMemory["change"] }));
      if (event === "agent-done") setMemory((m) => ({ ...m, agent: payload as TourMemory["agent"] }));
      if (!step || !here || step.advanceOn !== event || done) return;
      if (step.stay) setDone(true);
      else if (n < TOUR_LENGTH) go(n + 1);
    },
    [step, here, done, n, go],
  );

  const value = useMemo<TourApi>(
    () =>
      active
        ? { active, n, step, done, beat, memory, ready, resetToken, emit, restart }
        : { ...INACTIVE, resetToken },
    [active, n, step, done, beat, memory, ready, resetToken, emit, restart],
  );

  return (
    <TourContext.Provider value={value}>
      {ready ? (
        children
      ) : (
        <div className="mx-auto max-w-2xl px-4 py-16 text-center" role="status">
          <p className="font-serif text-[24px] text-ink-2">Setting this story back to its start…</p>
          <p className="mt-2 text-[13px] text-ink-3">The guided tour starts from the original synthetic record.</p>
        </div>
      )}
      {active && step && here && (
        <>
          <Spotlight
            key={`${n}:${done}`}
            target={(done && step.done?.target) || step.target}
            hotspot={done ? step.done?.hotspot : step.hotspot}
            show={ready}
          />
          <Coach
            n={n}
            step={step}
            done={done}
            beat={beat}
            memory={memory}
            ready={ready}
            onBack={() => go(n - 1)}
            onNext={() => (n < TOUR_LENGTH ? go(n + 1) : skip())}
            onGo={go}
            onSkip={skip}
            onRestart={restart}
            onReplay={() => setBeat(0)}
            pid={pid}
          />
        </>
      )}
    </TourContext.Provider>
  );
}

// ---------- coach ----------

function Coach({
  n,
  step,
  done,
  beat,
  memory,
  ready,
  pid,
  onBack,
  onNext,
  onGo,
  onSkip,
  onRestart,
  onReplay,
}: {
  n: number;
  step: TourStep;
  done: boolean;
  beat: number;
  memory: TourMemory;
  ready: boolean;
  pid: string;
  onBack: () => void;
  onNext: () => void;
  onGo: (n: number) => void;
  onSkip: () => void;
  onRestart: () => void;
  onReplay: () => void;
}) {
  const [why, setWhy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const body = done && step.done ? textOf(step.done.body, memory) : textOf(step.body, memory);
  const last = n === TOUR_LENGTH;

  return (
    <aside
      aria-label="Guided tour"
      data-tour-coach
      className={cn(
        "fixed z-[70] flex flex-col bg-paper text-ink",
        "inset-x-0 bottom-0 max-h-[50dvh] rounded-t-[12px] border-t-2 border-ink shadow-[0_-8px_24px_rgba(28,27,25,0.12)]",
        "lg:inset-x-auto lg:bottom-0 lg:right-0 lg:top-0 lg:max-h-none lg:w-[360px] lg:rounded-none lg:border-l-2 lg:border-t-0 lg:shadow-none",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-2.5 lg:py-3.5">
        <p className="smallcaps text-amber-ink" aria-live="polite">
          Guided tour · Step {n} of {TOUR_LENGTH}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Show the tour" : "Make the tour smaller"}
            className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-rule/50 hover:text-ink lg:hidden"
          >
            <ChevronDown className={cn("size-4 transition-transform", collapsed && "rotate-180")} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-ink-2 hover:bg-rule/50 hover:text-ink"
          >
            <X className="size-3.5" aria-hidden /> Skip tour
          </button>
        </div>
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3 lg:px-5 lg:pt-5", collapsed && "hidden lg:block")}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${n}:${done}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
          >
            <h2 className="font-serif text-[24px] leading-[1.1] lg:text-[28px]">{step.title}</h2>
            {!ready ? (
              <p className="mt-2 flex items-center gap-2 text-[13.5px] text-ink-2">
                <span className="size-1.5 animate-pulse rounded-full bg-amber" aria-hidden />
                Setting this story back to its start…
              </p>
            ) : (
              <>
                <p className="mt-2 text-[14px] leading-relaxed text-ink">{body}</p>
                {step.beats && (
                  <ol className="mt-3 space-y-1.5" aria-live="polite">
                    {step.beats.map((b, i) => (
                      <motion.li
                        key={b.id}
                        initial={false}
                        animate={{ opacity: i < beat ? 1 : 0.25, x: i < beat ? 0 : 4 }}
                        transition={{ duration: 0.35 }}
                        className="flex gap-2 text-[13.5px] leading-snug"
                      >
                        <span
                          aria-hidden
                          className={cn("mt-1.5 size-2 shrink-0 rounded-full border border-amber", i < beat && "bg-amber")}
                        />
                        {b.text}
                      </motion.li>
                    ))}
                  </ol>
                )}
                {step.beats && beat >= step.beats.length && (
                  <button type="button" onClick={onReplay} className="mt-2 inline-flex items-center gap-1 text-[12px] text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink">
                    <RotateCcw className="size-3" aria-hidden /> Play it again
                  </button>
                )}
                {!done && (
                  <p className="mt-3 flex items-start gap-2 rounded-[4px] border-l-[3px] border-amber bg-amber-wash/50 px-2.5 py-1.5 text-[13px] font-medium text-ink">
                    <MousePointerClick className="mt-0.5 size-3.5 shrink-0 text-amber-ink" aria-hidden />
                    {step.todo}
                  </p>
                )}
                {done && step.finish && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={`/packet/${encodeURIComponent(pid)}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-ink bg-ink px-3 text-[12.5px] font-medium text-ivory hover:bg-ink-2"
                    >
                      <FileText className="size-3.5" aria-hidden /> Open the packet
                    </Link>
                    <Button size="sm" variant="outline" onClick={onRestart}>
                      <RotateCcw className="size-3.5" aria-hidden /> Reset and try again
                    </Button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setWhy((v) => !v)}
                  aria-expanded={why}
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink-2 hover:text-ink"
                >
                  <ChevronDown className={cn("size-3.5 transition-transform", why && "rotate-180")} aria-hidden />
                  Why this matters
                </button>
                {why && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{step.why}</p>}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2.5 lg:px-5 lg:py-4">
        <Button size="sm" variant="outline" onClick={onBack} disabled={n === 1}>
          <ArrowLeft className="size-3.5" aria-hidden /> Back
        </Button>
        <ol className="flex items-center gap-1.5" aria-label="Tour progress">
          {TOUR_STEPS.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onGo(i + 1)}
                aria-label={`Step ${i + 1}: ${s.title}`}
                aria-current={i + 1 === n ? "step" : undefined}
                className={cn(
                  "block size-2 rounded-full border transition-all",
                  i + 1 === n ? "w-4 border-ink bg-ink" : i + 1 < n ? "border-amber bg-amber" : "border-rule-strong bg-transparent",
                )}
              />
            </li>
          ))}
        </ol>
        <Button size="sm" onClick={onNext} className={cn(done && "ring-2 ring-amber ring-offset-1 ring-offset-paper")}>
          {last ? "Finish" : "Next"} <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    </aside>
  );
}

// ---------- spotlight ----------

type Box = { x: number; y: number; w: number; h: number };

function boxOf(name: string | undefined): Box | null {
  if (!name) return null;
  const els = [...document.querySelectorAll<Element>(`[data-tour="${name}"]`)];
  const rects = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.left));
  const y = Math.min(...rects.map((r) => r.top));
  return { x, y, w: Math.max(...rects.map((r) => r.right)) - x, h: Math.max(...rects.map((r) => r.bottom)) - y };
}

const same = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

const PAD = 8;

/**
 * Bring the element into view above the bottom sheet (small screens) or beside the coach (desktop).
 * An element taller than the room left is aligned by its hotspot instead, so the thing to click shows.
 */
function scrollToTarget(target: string, hotspot: string | undefined, smooth: boolean) {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return false;
  const coach = document.querySelector<HTMLElement>("[data-tour-coach]");
  const sheet = coach && window.innerWidth < 1024 ? coach.getBoundingClientRect().height : 0;
  const room = window.innerHeight - sheet;
  const tall = (boxOf(target)?.h ?? 0) + 2 * PAD > room - 24;
  const spot = hotspot ? document.querySelector<Element>(`[data-tour="${hotspot}"]`) : null;
  const name = tall && spot ? (hotspot as string) : target;
  // Sideways (the timeline scrolls inside its box): only as far as the thing to click needs, so the
  // medicine names on the left stay in view.
  (spot ?? el).scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" as ScrollBehavior });
  const box = boxOf(name);
  if (!box) return true;
  const top = name === target && tall ? 16 : Math.max(16, (room - box.h) / 2);
  window.scrollBy({ top: box.y - top, behavior: smooth ? "smooth" : "auto" });
  return true;
}

/** True when the element's centre is on screen and not under the bottom sheet. */
function inView(name: string) {
  const box = boxOf(name);
  if (!box) return true;
  const coach = document.querySelector<HTMLElement>("[data-tour-coach]");
  const bottom = coach && window.innerWidth < 1024 ? coach.getBoundingClientRect().top : window.innerHeight;
  const cy = box.y + box.h / 2;
  return cy > 0 && cy < bottom;
}

function Spotlight({ target, hotspot, show }: { target: string; hotspot?: string; show: boolean }) {
  const reduced = useReducedMotion();
  const [box, setBox] = useState<Box | null>(null);
  const [spot, setSpot] = useState<Box | null>(null);
  const boxRef = useRef<Box | null>(null);
  const spotRef = useRef<Box | null>(null);

  // Follow the elements every frame: they move with scrolling, layout and animation.
  useEffect(() => {
    if (!show) return;
    let raf = 0;
    const tick = () => {
      const b = boxOf(target);
      const s = boxOf(hotspot);
      if (!same(b, boxRef.current)) setBox((boxRef.current = b));
      if (!same(s, spotRef.current)) setSpot((spotRef.current = s));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, hotspot, show]);

  // Scroll once the element exists (data may still be loading when the step starts).
  useEffect(() => {
    if (!show) return;
    let tries = 0;
    let checks = 0;
    let timer: ReturnType<typeof setTimeout>;
    // Content above the target can still be loading and push it away: look again a few times.
    const settle = () => {
      if (++checks > 4) return;
      if (!inView(hotspot ?? target)) scrollToTarget(target, hotspot, !reduced);
      timer = setTimeout(settle, 600);
    };
    const attempt = () => {
      if (scrollToTarget(target, hotspot, !reduced)) {
        timer = setTimeout(settle, 700);
        return;
      }
      if (++tries < 20) timer = setTimeout(attempt, 250);
    };
    timer = setTimeout(attempt, 350);
    return () => clearTimeout(timer);
  }, [target, hotspot, show, reduced]);

  if (!show || !box) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      <motion.div
        className="absolute rounded-[10px] border-2 border-amber"
        initial={false}
        animate={{ left: box.x - PAD, top: box.y - PAD, width: box.w + 2 * PAD, height: box.h + 2 * PAD }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 38 }}
        style={{ boxShadow: "0 0 0 9999px rgba(28, 27, 25, 0.42)" }}
      />
      {spot && (
        <div className="absolute" style={{ left: spot.x + spot.w / 2, top: spot.y + spot.h / 2 }}>
          <span className="fd-hotspot absolute -left-4 -top-4 size-8 rounded-full border-2 border-amber" />
          <span className="absolute -left-1.5 -top-1.5 size-3 rounded-full border-2 border-ivory bg-amber" />
        </div>
      )}
    </div>
  );
}
