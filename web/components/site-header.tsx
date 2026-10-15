import Link from "next/link";

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
