import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Patient lab",
  "Build a synthetic patient, write it to FalkorDB and watch the same rules as the stories walk the graph, live.",
);

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
