"use client";

// Reference sheet of the workspace's distinct states, for review and QA.
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  InsufficientEvidenceState,
  LoadingState,
  NoMatchState,
  StaleState,
  UnavailableState,
} from "@/components/state-notice";

const STATES = [
  { name: "Loading", when: "Any view while its data is on the way.", node: <LoadingState /> },
  {
    name: "Evaluation unavailable",
    when: "The API or engine could not answer. Never shown as “no pattern”.",
    node: <UnavailableState message="The evaluation service could not be reached." onRetry={() => {}} />,
  },
  {
    name: "Insufficient evidence",
    when: "A finding is needs_evidence: the timing fits but a required fact is not known yet.",
    node: <InsufficientEvidenceState missing={["reason furosemide was started"]} />,
  },
  {
    name: "No matched pattern",
    when: "The evaluation ran and returned no open findings.",
    node: <NoMatchState patterns={1} />,
  },
  {
    name: "Stale (409)",
    when: "A write carried an old case_version or revision. Nothing was saved.",
    node: <StaleState sent={4} current={5} onReload={() => {}} />,
  },
];

export default function StatesPage() {
  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
        <SiteHeader className="pt-0" />
        <h1 className="mt-8 font-serif text-[40px] leading-none">Interface states</h1>
        <p className="mt-2 text-[14px] text-ink-2">
          Every view is in exactly one of these. Coral is reserved for errors.
        </p>
        <ol className="mt-8 space-y-8">
          {STATES.map((s, i) => (
            <li key={s.name} className="grid gap-3 border-t border-rule pt-5 sm:grid-cols-[200px_1fr]">
              <div>
                <p className="font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</p>
                <h2 className="font-serif text-[22px] leading-tight">{s.name}</h2>
                <p className="mt-1 text-[12.5px] text-ink-3">{s.when}</p>
              </div>
              <div>{s.node}</div>
            </li>
          ))}
        </ol>
      </div>
      <SiteFooter />
    </>
  );
}
