import type { Metadata } from "next";
import Link from "next/link";
import { FileText, MessageCircleQuestion, Network } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "How it works · FirstDomino",
  description: "Records become a graph; the graph finds possible chains and the one fact that would settle each.",
};

const FLOW = [
  {
    icon: FileText,
    title: "Records",
    text: "Letters, pharmacy records, what the caregiver says. Each fact keeps its source, its day and how sure it is.",
  },
  {
    icon: Network,
    title: "Graph",
    text: "Every medicine, symptom, record and finding is a node in FalkorDB, matched against cited patterns.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Questions",
    text: "It asks for the one missing fact that settles the most, from the person who knows. The clinician decides.",
  },
];

const FALKOR = [
  ["Finds the chain", "A pattern match is one walk from the patient: medicine → its class → the pattern → a second medicine, with the symptom in between."],
  ["Knows what depends on what", "When a fact changes, the graph points straight at the findings that cite, link or need it. Only those are re-checked."],
  ["Picks the next question", "It counts how many open findings wait on each missing fact and asks for the one that unblocks the most."],
  ["Keeps every version", "Old values, earlier versions of a finding and each clinician's decision stay in the graph, linked to what they were about."],
  ["Refuses stale writes", "Every write checks the case version inside one query, so two people saving at once cannot overwrite each other."],
];

type N = { id: string; x: number; y: number; label: string; tone?: "amber" | "teal" | "ink" };
const NODES: N[] = [
  { id: "patient", x: 60, y: 150, label: "Patient", tone: "ink" },
  { id: "med1", x: 210, y: 60, label: "Medicine 1" },
  { id: "symptom", x: 210, y: 150, label: "Symptom" },
  { id: "med2", x: 210, y: 240, label: "Medicine 2" },
  { id: "record", x: 60, y: 260, label: "Record" },
  { id: "pattern", x: 380, y: 60, label: "Pattern (cited)", tone: "amber" },
  { id: "finding", x: 380, y: 150, label: "Finding", tone: "amber" },
  { id: "missing", x: 380, y: 240, label: "Missing fact" },
  { id: "question", x: 540, y: 240, label: "Question" },
  { id: "version", x: 540, y: 150, label: "Version" },
  { id: "decision", x: 540, y: 60, label: "Decision", tone: "teal" },
];
const EDGES: [string, string, string][] = [
  ["patient", "med1", "has"],
  ["patient", "symptom", "has"],
  ["patient", "med2", "has"],
  ["med2", "record", "from"],
  ["pattern", "med1", "first"],
  ["finding", "pattern", "matches"],
  ["finding", "symptom", "cites"],
  ["finding", "med2", "to"],
  ["finding", "missing", "needs"],
  ["question", "missing", "asks for"],
  ["version", "finding", "of"],
  ["decision", "version", "on"],
];

function GraphDiagram() {
  const at = new Map(NODES.map((n) => [n.id, n]));
  const stroke = { amber: "var(--amber)", teal: "var(--teal)", ink: "var(--ink)" } as const;
  return (
    <figure className="overflow-x-auto rounded-[8px] border border-rule-strong bg-paper p-3 [scrollbar-width:thin]">
      <svg viewBox="0 0 620 300" className="min-w-[560px]" role="img" aria-label="The graph model: a patient has medicines, symptoms and records; a finding matches a cited pattern, cites the facts it links and needs a missing fact; a question asks for it; each finding keeps versions, and decisions sit on a version.">
        <defs>
          <marker id="hw-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1 L6 4 L1 7" fill="none" stroke="var(--ink-3)" strokeWidth="1.3" />
          </marker>
        </defs>
        {EDGES.map(([a, b, label]) => {
          const p = at.get(a)!;
          const q = at.get(b)!;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const len = Math.hypot(dx, dy);
          const r = 34;
          const x1 = p.x + (dx / len) * r;
          const y1 = p.y + (dy / len) * (r * 0.55);
          const x2 = q.x - (dx / len) * r;
          const y2 = q.y - (dy / len) * (r * 0.55);
          return (
            <g key={`${a}-${b}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-3)" strokeWidth={1.2} markerEnd="url(#hw-arrow)" />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle" paintOrder="stroke" stroke="var(--paper)" strokeWidth={4} className="fill-[var(--ink-3)] text-[10.5px]">
                {label}
              </text>
            </g>
          );
        })}
        {NODES.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x - 52}
              y={n.y - 16}
              width={104}
              height={32}
              rx={16}
              fill={n.tone === "amber" ? "var(--amber-wash)" : n.tone === "teal" ? "var(--teal-wash)" : "var(--ivory)"}
              stroke={n.tone ? stroke[n.tone] : "var(--ink-2)"}
              strokeWidth={1.5}
            />
            <text x={n.x} y={n.y + 4.5} textAnchor="middle" className="fill-[var(--ink)] text-[12.5px]">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 text-[12px] text-ink-3">
        Simplified. Every walk starts from one patient, so one patient&rsquo;s facts never mix with another&rsquo;s.
      </figcaption>
    </figure>
  );
}

export default function HowItWorks() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-4 pb-4 sm:px-8">
        <SiteHeader current="how" />

        <h1 className="mt-10 font-serif text-[clamp(36px,6vw,56px)] leading-[1.02]">How it works</h1>
        <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
          Records go in, a graph connects them, and FirstDomino asks for the fact that is missing. It flags possible
          patterns for a clinician to review. It never says one thing led to another, and it never changes a medicine.
        </p>

        <ol className="mt-8 grid gap-px overflow-hidden rounded-[8px] border border-ink bg-ink md:grid-cols-3">
          {FLOW.map((s, i) => (
            <li key={s.title} className="relative bg-paper p-5">
              <div className="flex items-center gap-2">
                <s.icon className="size-5 text-amber-ink" aria-hidden />
                <p className="font-mono text-[11px] text-ink-3">{i + 1}</p>
              </div>
              <h2 className="mt-2 font-serif text-[24px] leading-tight">
                {s.title}
                {i < FLOW.length - 1 && <span className="ml-2 text-amber-ink" aria-hidden>&rarr;</span>}
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
            </li>
          ))}
        </ol>

        <section aria-labelledby="model-h" className="mt-12">
          <h2 id="model-h" className="font-serif text-[30px]">The graph model</h2>
          <p className="mt-1 max-w-[65ch] text-[13.5px] text-ink-2">
            A finding is a node of its own, linked to the facts it rests on, the pattern it matches and the fact it still
            needs. That is what lets one changed fact move exactly the right findings.
          </p>
          <div className="mt-4">
            <GraphDiagram />
          </div>
        </section>

        <section aria-labelledby="falkor-h" className="mt-12">
          <h2 id="falkor-h" className="font-serif text-[30px]">What FalkorDB does here</h2>
          <dl className="mt-4 divide-y divide-rule border-y border-rule">
            {FALKOR.map(([title, text]) => (
              <div key={title} className="grid gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
                <dt className="font-serif text-[19px] leading-snug">{title}</dt>
                <dd className="text-[13.5px] leading-relaxed text-ink-2">{text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12.5px] text-ink-3">
            Without the graph the app can only replay saved examples. With it, every answer is checked, versioned and
            traceable. In any review, open &ldquo;How the graph found this&rdquo; and turn on &ldquo;Show technical
            details&rdquo; to see the named queries and their Cypher.
          </p>
          <p className="mt-2 text-[12.5px] text-ink-3">
            AI assistants such as Claude Desktop can use the same review through FirstDomino&rsquo;s MCP server:
            read-only tools that go through this API and return the evidence IDs behind every answer.
          </p>
        </section>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link href="/patients/syn-p1?tour=story1&step=1" className="inline-flex h-10 items-center rounded-[6px] border border-ink bg-ink px-4 text-[14px] font-medium text-ivory hover:bg-ink-2">
            Take the 2-minute guided tour
          </Link>
          <Link href="/#stories" className="inline-flex h-10 items-center rounded-[6px] border border-ink px-4 text-[14px] font-medium text-ink hover:bg-paper">
            Explore the stories
          </Link>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
