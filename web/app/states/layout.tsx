import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("Interface states", "Every view in FirstDomino is in exactly one of these states. Unavailable is never shown as “no pattern”.");

export default function StatesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
