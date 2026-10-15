import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FirstDomino",
  description: "Possible prescribing cascades for a pharmacist's medication review. Synthetic data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
