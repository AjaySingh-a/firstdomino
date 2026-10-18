import { ImageResponse } from "next/og";

// The link preview for every page: the wordmark, the one-line idea, and the chain in miniature.
export const alt = "FirstDomino: possible prescribing cascades, found on a graph. Synthetic data.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const ink = "#1c1b19";
  const node = (label: string, bg: string) => (
    <div style={{ display: "flex", padding: "14px 26px", border: `3px solid ${ink}`, borderRadius: 40, background: bg, fontSize: 30 }}>{label}</div>
  );
  const link = <div style={{ display: "flex", width: 70, height: 4, background: "#e8a33d" }} />;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 72, background: "#f7f3ea", color: ink }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", flexShrink: 0, width: 34, height: 60, borderRadius: 5, border: `3px solid ${ink}`, background: "#e8a33d" }} />
          <div style={{ fontSize: 52 }}>FirstDomino</div>
          <div style={{ marginLeft: "auto", fontSize: 24, color: "#6b665c" }}>Synthetic data · Graph Hacks 2026</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 64, lineHeight: 1.08, maxWidth: 1000 }}>A side effect of one medicine, treated with another.</div>
          <div style={{ fontSize: 30, color: "#4a4740" }}>Finds possible prescribing cascades on a FalkorDB graph and asks for the missing fact.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {node("amlodipine", "#fbf8f1")}
            {link}
            {node("ankle swelling", "#f6e6c8")}
            {link}
            {node("furosemide", "#fbf8f1")}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
