// Contract smoke page: proves lib/api.ts works in both modes. Ajay replaces this with the real UI.
import { api, DATA_SOURCE } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  const patients = await api.patients();
  const rows = await Promise.all(
    patients.map(async (p) => ({ patient: p, findings: (await api.findings(p.id)).findings })),
  );
  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-10">
      <h1 className="text-2xl font-semibold">FirstDomino</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Synthetic patients only. Findings are possible patterns for a clinician to review. Data
        source: <code>{DATA_SOURCE}</code>
      </p>
      <ul className="mt-6 space-y-4">
        {rows.map(({ patient, findings }) => (
          <li key={patient.id} className="rounded-lg border border-border p-4">
            <div className="font-medium">
              {patient.label} <span className="text-muted-foreground">({patient.id}, v{patient.case_version})</span>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {findings.map((f) => (
                <li key={f.id}>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{f.status}</span>{" "}
                  {f.headline}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
