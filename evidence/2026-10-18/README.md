# Evidence: final check, 18 Oct 2026

Saved from the **live** deployment (https://firstdomino-web.vercel.app and
https://api-production-b29f.up.railway.app) after F-1 to F-5 were merged and deployed. Synthetic data only.

| File | What it shows |
|---|---|
| `health.json` | `{"status":"ok","mode":"graph","falkordb":"up","appendonly":"yes"}` |
| `finding-path-syn-p1.json` | `GET /findings/syn-p1:fnd-ccb-edema-loop-1/path`: q11's own path, 7 nodes and 6 relationships in walk order, plus pattern → effect ← symptom, `mode: live` |
| `lab-chain.json`, `lab-wrong-order.json`, `lab-lookalike.json` | `POST /lab/patients` for three presets: request, findings, per-step ms, q11 paths and q12 (`algo.SPpaths`) links |
| `lab-summary.json` | The three lab results side by side (below) |
| `q3-atorvastatin-vs-swelling.json` | Q3 on story 3: atorvastatin → no findings; ankle swelling → one finding |
| `story3-history.json` | Story 3 after the late GP note: revision 2 `needs_reassessment`, the clinician's decision kept on revision 1 |
| `agent-runs-syn-p1.json` | Two review-agent runs on story 1: run 2 has no `ask_question` step and its `next_missing_fact` step is "answered from memory", citing run 1's question and step |
| `mcp-explain-path.txt`, `mcp-live.txt` | The MCP `explain_path` tool against the live API; `FD_MCP_LIVE=1 uv run pytest tests/test_mcp_live.py` → 7 passed |
| `tests.txt`, `bench.txt` | `make test` 191 passed, `make test-stack` 37 passed, `make lint` clean; `make bench` 12 of 12 cases (98 of 98 checks) |
| `*-1440.png`, `*-375.png` | Landing, stories 1-3, packet, How it works and the lab at both widths |

## The three lab presets (live)

| Preset | Findings (the rules) | q12 `algo.SPpaths` | Total time on the live graph |
|---|---|---|---|
| Reason not recorded (amlodipine d0, furosemide d35, swelling d21 reported) | `needs_evidence` | path C08CA → pattern → C03CA | 95.7 ms |
| Wrong order (furosemide d5 before amlodipine d30) | `not_matched` | path still exists: the path explains, the rules decide | 74.5 ms |
| A lookalike medicine (diltiazem, C08DB) | none | **no path** from diltiazem (C08DB) to furosemide (C03CA) | 71.9 ms |

Times include writing the patient and its knowledge links; the q11 and q12 queries themselves take a few
milliseconds (see `steps_ms` in `lab-summary.json`).

## Browser check (headless Chromium, 1440 px and 375 px)

All 10 guided-tour steps, the three lab presets, stories 1-3, the packet, How it works and `/states`:
**zero console errors and no horizontal overflow** at both widths. The demo was reset afterwards
(`POST /sandbox/reset`), which also removes the lab patients.
