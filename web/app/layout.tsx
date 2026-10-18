import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SITE_URL, pageMeta } from "@/lib/meta";
import { Providers } from "./providers";

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-instrument-serif",
});
const sans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  ...pageMeta(
    "FirstDomino · possible prescribing cascades, on a graph",
    "Sometimes a side effect of one medicine is treated with another medicine. FirstDomino finds these possible chains in synthetic patients and asks for the one missing fact.",
  ),
  title: { default: "FirstDomino · possible prescribing cascades, on a graph", template: "%s · FirstDomino" },
};

export const viewport: Viewport = {
  themeColor: "#F7F3EA",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-ivory text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
