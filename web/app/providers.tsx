"use client";

import { MotionConfig } from "framer-motion";
import { TechProvider } from "@/lib/tech";

/** App-wide client context: motion follows the visitor's reduced-motion setting; the technical-details switch. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TechProvider>{children}</TechProvider>
    </MotionConfig>
  );
}
