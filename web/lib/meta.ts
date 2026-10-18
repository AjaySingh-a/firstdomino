// Page metadata for link previews. The Open Graph image is app/opengraph-image.tsx, shared by every page.

import type { Metadata } from "next";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://firstdomino-web.vercel.app";

export function pageMeta(title: string, description: string): Metadata {
  return {
    title,
    description,
    openGraph: { title, description, siteName: "FirstDomino", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}
