"use client";

import Link from "next/link";
import { API_HEALTH_URL } from "@/lib/api";
import { startTour, tourHref } from "@/lib/tour";
import { cn } from "@/lib/utils";

const REPO = "https://github.com/AjaySingh-a/firstdomino";
// A null link is shown as "soon".
const DEMO_VIDEO_URL: string | null = "https://youtu.be/2DeOnoqJeyY";
const BLOG_URL: string | null = "https://dev.to/devgr72/every-prescription-looked-reasonable-the-chain-didnt-13i7";

type Item = { label: string; href: string | null; external?: boolean; onClick?: () => void };

const COLUMNS: { title: string; items: Item[] }[] = [
  {
    title: "Try it",
    items: [
      { label: "Guided tour", href: tourHref(1), onClick: startTour },
      { label: "Patient lab", href: "/lab" },
      { label: "Stories", href: "/#stories" },
      { label: "Example packet", href: "/packet/syn-p1" },
    ],
  },
  {
    title: "Learn",
    items: [
      { label: "How it works", href: "/how-it-works" },
      { label: "API health", href: API_HEALTH_URL, external: true },
      { label: "GitHub repo", href: REPO, external: true },
      { label: "Demo video", href: DEMO_VIDEO_URL, external: true },
      { label: "Blog", href: BLOG_URL, external: true },
    ],
  },
  {
    title: "Built with",
    items: [
      { label: "FalkorDB", href: "https://www.falkordb.com", external: true },
      { label: "FastAPI", href: "https://fastapi.tiangolo.com", external: true },
      { label: "Next.js", href: "https://nextjs.org", external: true },
      { label: "Groq", href: "https://groq.com", external: true },
      { label: "MCP", href: "https://modelcontextprotocol.io", external: true },
    ],
  },
];

const linkCls = "text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink hover:decoration-ink";

function FooterLink({ item }: { item: Item }) {
  if (!item.href)
    return (
      <span className="text-ink-3">
        {item.label} <span className="smallcaps text-[10px]">soon</span>
      </span>
    );
  if (item.external)
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={linkCls}>
        {item.label}
      </a>
    );
  return (
    <Link href={item.href} onClick={item.onClick} className={linkCls}>
      {item.label}
    </Link>
  );
}

/** The footer on every page (the workspace keeps it below its own layout). */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("mt-16 border-t border-ink bg-paper print:hidden", className)}>
      <div className="wrap grid grid-cols-2 gap-x-6 gap-y-8 py-14 sm:grid-cols-[1.6fr_repeat(3,1fr)]">
        <div className="col-span-2 sm:col-span-1">
          <p className="font-display text-[28px] font-extrabold leading-none tracking-[-0.03em]">FirstDomino</p>
          <p className="mt-2 max-w-[30ch] text-[13px] leading-snug text-ink-2">
            Finds possible prescribing cascades across visits, and asks for the fact a clinician still needs.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <p className="smallcaps text-ink-3">{c.title}</p>
            <ul className="mt-3 space-y-2 text-[13.5px]">
              {c.items.map((i) => (
                <li key={i.label}>
                  <FooterLink item={i} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-rule">
        <p className="wrap flex flex-wrap gap-x-3 gap-y-1 py-5 text-[12px] text-ink-3">
          <span className="w-full sm:w-auto">All patients are synthetic. Possible patterns for a clinician to review, never conclusions.</span>
          <span aria-hidden className="hidden sm:inline">·</span>
          <span>Team Kodeline</span>
          <span aria-hidden>·</span>
          <span>Graph Hacks 2026</span>
          <span aria-hidden>·</span>
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="underline decoration-rule-strong underline-offset-2 hover:text-ink">
            MIT licence
          </a>
        </p>
      </div>
    </footer>
  );
}
