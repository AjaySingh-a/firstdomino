# How we used AI

FirstDomino was built by team Kodeline (Ajay Singh, Dev Grover) for Graph Hacks 2026. AI shows up in
two separate places: an AI coding assistant helped us **build** the project, and a hosted LLM is a small,
fenced-in part of the **running product**. This page describes both, and what we did ourselves.

## 1. Claude Code, our coding assistant

We used **Claude Code** (Anthropic) as our coding assistant throughout the hackathon.

**What the assistant generated**

- Much of the code, tests and documentation in this repository. We wrote one task prompt per piece of
  work, and the assistant read the codebase, wrote the code and tests, ran them, and opened the pull
  request. Examples:
  - the first-visit guided-tour offer in the web app
  - the MCP server (`mcp_server/`) and its tests
  - this README and this page
- The 12 P2 proof cases (`data/cases/`) and their runner (`bench/run.py`). We told it to derive every
  expected result only from `docs/data-model.md` and the story fixtures, not from `engine/rules.py`,
  and never to change the engine to make a case pass.
- Research help: it looked up and checked the literature cited in the README against Crossref. Where a
  source did not say what we assumed, it said so. The India study, for example, measures polypharmacy,
  not prescribing cascades, and the README says that.

**What we designed, decided, reviewed and verified ourselves**

- **The plan:** the problem, the primary user (a pharmacist doing a medication review), the roles
  (the caregiver supplies facts, the clinician decides), the scope, the tracks we entered, the task
  breakdown and who owns what.
- **The evidence model:**
  - every fact has `happened_at`, `recorded_at` and a state (`documented`, `reported`, `conflicting`,
    `unknown`)
  - `not_available` is never read as "no"
  - facts are versioned, findings get revisions, and decisions stay on the revision they were made on
  - stale writes get a 409, and evidence events are idempotent
  - every traversal starts from the patient
- **The three synthetic stories**, and what each one should show.
- **The rule decisions:**
  - the precedence of the statuses
  - a different reason that is only reported by the caregiver still gives `competing_explanation`
  - the 90-day window is shown but excludes nothing
  - adverse-event report counts are not used as evidence weights
  - the LLM never creates findings
  - the copy rules: never "safe", "stop taking", "cleared" or "caused by"
- **Review:** we read the assistant's pull requests and decided what was merged. When the proof suite
  found under-documented behaviour, we decided how to document it.
- **Browser testing:** we walked through the guided tour and the stories in the browser ourselves,
  on top of the assistant's headless-browser checks.
- **Deployment checks:** we checked the live health and data routes on Railway and Vercel, a live
  review-agent pass, and that the data survived a restart. The keys are ours and live only in the
  platforms' variables.

**Guardrails we put around the assistant's work**

Tests that the assistant's code has to pass:

- the copy-rule scan
- the contract tests (every query is a named file, and every query starts from the patient)
- the golden graph tests
- the MCP tests
- the restart test

We asked for honest reporting of failures, and kept the engine unchanged when the proof suite ran.

## 2. The Groq-hosted LLM inside the review agent

The review agent (`agent/`) calls an LLM through **Groq's** OpenAI-compatible API
(`openai/gpt-oss-120b` by default, with an optional fallback model set by `FD_AGENT_FALLBACK_MODEL`).

- **What it does:** in each of at most six steps, it picks one of six allowlisted tools and, for two
  of them, phrases a short text: the question to ask, and the note for the clinician. It works only
  with evidence IDs it was given.
- **What it cannot do:**
  - create or change a finding (only `engine/rules.py` does)
  - answer a question
  - write evidence
  - change a fact
  - record a decision
- **How it is checked:** every reply must be valid JSON with an allowed tool, and its args and cited
  IDs must come from earlier tool results. Its text may not contain invented days, dates, medicines or
  reasons, or certainty words, and it must follow the copy rules. A rejected reply gets one retry, then
  deterministic templates take over, and the reason is recorded on the step. With no API key, the
  whole pass runs on templates.
- **What it sees:** only the synthetic stories' evidence. No real patient data exists in this project.

## 3. Claude Desktop through MCP (a product feature)

`mcp_server/` lets an AI client such as Claude Desktop read FirstDomino through its HTTP API. This is a
feature of the product, not part of how we built it. Those tools are read-only by default and return
the evidence IDs behind every answer.

## What this means for judging the work

The architecture, the evidence model, the stories, the rules and the decisions about what FirstDomino
may and may not say are ours. Much of the typing was done by an AI coding assistant, under our
direction and review. Nothing here has been clinically validated. The proof suite measures agreement
with our own documented rules, not clinical accuracy.
