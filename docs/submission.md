# Submission pack (WeMakeDevs form)

Ready to paste. Team **Kodeline** (Ajay Singh, Dev Grover). Submit by 21:00 IST. The team locks once
submitted.

## Project name

FirstDomino

## Tagline (one line)

Finds possible prescribing cascades in a patient's medication story as one walk through a FalkorDB graph, and asks for the one missing fact a clinician needs.

## Short description

Sometimes a side effect of one medicine is mistaken for a new illness and treated with another
medicine: a prescribing cascade. FirstDomino rebuilds a synthetic patient's medication story across
visits as a FalkorDB graph and matches it against cited patterns through drug classes. It asks for the
single missing fact that would settle each possible chain, and keeps every fact, finding, question and
clinician decision with its full history. Judges can build their own patient in the patient lab and
watch the graph evaluate it live.

## Long description

**The problem.** A prescribing cascade starts when a side effect is treated as a new condition. The
classic example is amlodipine → ankle swelling → furosemide. Each step looks reasonable on its own.
The pattern only shows when someone lines up letters, pharmacy records, discharges and what the family
remembers, and that story is rarely in one place. International panels have listed these cascades
(ThinkCascades 2022, the PIPC list 2025), and a 2026 BMJ study of 2.3 million older adults found 24 of
them to be common and closely timed.

**What FirstDomino does.** It is for a pharmacist doing a medication review. The caregiver supplies
facts and the clinician decides.

- Every medicine, symptom, source, finding, question and review is a node in FalkorDB. Each fact
  carries its state (documented, reported by the caregiver, conflicting, unknown) and both when it
  happened and when it was recorded.
- **Q1** finds a chain as a single traversal from the patient: medicine → ATC class → cited pattern →
  side effect → symptom → second medicine. Deterministic, tested rules set the status (`candidate`,
  `needs_evidence`, `competing_explanation`, `not_matched`, `needs_reassessment`, `reviewed`). None of
  them means "caused".
- **Q2** picks the next question: the missing fact the most open findings wait on, and who can answer
  it.
- **Q3** follows a changed fact's edges to the findings that depend on it. Only those are re-checked.
  Changing an unrelated medicine reopens nothing.
- Nothing is overwritten. Fact versions, finding revisions and decisions stay on the revision they
  were made on. Stale writes get a 409, and evidence events are idempotent and resume after a crash.
- A bounded **review agent** (Groq LLM, six allowlisted tools, at most six steps) reads the evidence,
  asks for the missing fact and drafts the clinician packet. It can never create a finding or change a
  fact. Every reply is validated, templates are the fallback, and every step is saved in the graph.
- An **MCP server** exposes the same read-only tools to Claude Desktop.
- The **patient lab** lets anyone build a synthetic patient. It is written to FalkorDB and evaluated
  by the same queries and rules in milliseconds, next to what a flat medicine list would say. Without
  FalkorDB the lab returns 503: there is no fallback.

**Proof.** 12 of 12 synthetic cases (98 of 98 checks) agree with the documented rules on the graph
engine. A runner self-check catches all 5 deliberately wrong expectations. A restart test of FalkorDB
and the API reads everything back unchanged (AOF on). This is agreement with our own documented rules,
not clinical accuracy.

All patient data is synthetic. FirstDomino is a prototype, not a medical device, and it does not
recommend changing any medicine.

## Tracks

- Agents That Act on Connected Data
- Agent Memory and Coordination

## Links

- **Repository:** https://github.com/AjaySingh-a/firstdomino
- **Live app:** https://firstdomino-web.vercel.app
- **API health:** https://api-production-b29f.up.railway.app/health
- **Demo video:** VIDEO_LINK
- **Blog:** BLOG_LINK

## Tech stack

FalkorDB 4.22 (graph database, AOF persistence) · Cypher (named, parameterised query files) ·
Python 3.11, FastAPI, Pydantic, uv · Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui,
framer-motion · Groq (OpenAI-compatible API, `openai/gpt-oss-120b`) for the review agent's phrasing ·
MCP Python SDK (FastMCP) · Docker Compose · Railway (API + FalkorDB) · Vercel (web) · pytest, Playwright.

## AI usage summary

We used **Claude Code** as our coding assistant. It wrote much of the code, tests and docs from our
task prompts and opened pull requests that we reviewed and merged. We designed the problem, the
evidence model, the stories, the rule decisions and the copy rules ourselves, and we tested in the
browser and on the live deployment. In the product, a **Groq-hosted LLM** only phrases the review
agent's steps and picks among allowlisted tools. It never creates findings, and deterministic
templates take over when it fails. Details: [AI_USAGE.md](../AI_USAGE.md).

## Rule 10 checklist (verified in the repo)

| Requirement | Where | Status |
|---|---|---|
| Public repository | https://github.com/AjaySingh-a/firstdomino (visibility: PUBLIC, MIT licence) | ✅ |
| README with setup instructions | README.md → "Run locally" (Docker Compose, make / non-make commands) | ✅ |
| README with the graph data model | README.md → "Architecture and graph model" (labels, relationships, two Mermaid diagrams); full detail in docs/data-model.md | ✅ |
| The Cypher queries | `engine/queries/` (10 read queries, `write/`, `admin/`), every one listed in README.md → "Every Cypher query" | ✅ |
| Demo video | README.md "Video" line and this page | ⏳ add the YouTube link after upload |
| Live deployment | https://firstdomino-web.vercel.app and https://api-production-b29f.up.railway.app/health (`falkordb: up`, `appendonly: yes`) | ✅ |
| Tracks named | README.md → "Tracks entered"; this page | ✅ |
