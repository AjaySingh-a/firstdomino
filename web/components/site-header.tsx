import Link from "next/link";
import { cn } from "@/lib/utils";
import { TourButton } from "./tour-offer";

/** The wordmark: a single domino, the first one amber. */
export function Wordmark() {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="FirstDomino home">
      <span aria-hidden className="relative inline-block h-6 w-3.5">
        <span className="absolute inset-0 origin-bottom-right rounded-[2px] border border-ink bg-amber transition-transform duration-500 group-hover:rotate-[24deg]">
          <span className="absolute inset-x-0.5 top-1/2 h-px bg-ink/60" />
        </span>
      </span>
      <span className="font-serif text-[22px] leading-none tracking-tight">FirstDomino</span>
    </Link>
  );
}

export type NavPage = "lab" | "how";

const link = "text-[12.5px] underline underline-offset-2 hover:text-ink";

/** The nav every page shares: Guided tour · Patient lab · How it works. The workspace uses it too. */
export function SiteNav({ current, onTourRestart, className }: { current?: NavPage; onTourRestart?: () => void; className?: string }) {
  return (
    <nav aria-label="Main" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <TourButton onRestart={onTourRestart} />
      <Link
        href="/lab"
        aria-current={current === "lab" ? "page" : undefined}
        className={cn(link, "font-medium decoration-amber", current === "lab" ? "text-ink" : "text-amber-ink")}
      >
        Patient lab
      </Link>
      <Link
        href="/how-it-works"
        aria-current={current === "how" ? "page" : undefined}
        className={cn(link, "decoration-rule-strong", current === "how" ? "font-medium text-ink" : "text-ink-2")}
      >
        How it works
      </Link>
    </nav>
  );
}

/** The header for every page outside the workspace. `children` sits after the nav (the packet's toolbar). */
export function SiteHeader({ current, children, className }: { current?: NavPage; children?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-ink py-4", className)}>
      <Wordmark />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SiteNav current={current} className="print:hidden" />
        {children}
      </div>
    </header>
  );
}
