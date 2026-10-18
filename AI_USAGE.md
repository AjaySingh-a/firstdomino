# How we used AI

FirstDomino was built by team Kodeline (Ajay Singh, Dev Grover) for Graph Hacks 2026. AI shows up in
two separate places: an AI coding assistant helped us **build** the project, and a hosted LLM is a small,
fenced-in part of the **running product**. This page describes both, and what we did ourselves.

## How we planned and worked

**One plan, two owners, one written agreement.** Before writing code we fixed the problem, the users
(the pharmacist reviews, the caregiver supplies facts, the clinician decides) and the copy rules, and
split ownership: Dev owns the engine and API (`engine/`, `api/`), Ajay owns the web app, the review agent
and the MCP server (`web/`, `agent/`, `mcp_server/`). Shared contracts (`api/models.py`,
`web/lib/types.ts`, the fixtures and docs) change in one pull request with both sides updated. We wrote
these rules down in [AGENTS.md](AGENTS.md), and the coding assistant read that file at the start of
every session, so it worked to the same conventions we did: named Cypher files only, every traversal
starting from the patient, day numbers for dates, the banned words.

**Small, numbered tasks, each ending in a pull request.** The git history shows the plan as it ran:
`D-1` to `D-6` (engine, API, deploy, patient lab), `A-1` to `A-8` (web app, agent, guided tour, MCP),
`P2` (the proof suite) and `B-1` (the README). For each task we wrote the prompt, which said what to
build, what not to touch and how to prove it worked. The assistant wrote the code and tests, and ran
them. We read the pull request and decided whether it merged.

**Tests as the contract, not trust.** Anything the assistant produced had to pass checks we chose
up front (listed below). When it reported a failure, we kept the failure visible instead of editing the
expectation. The proof suite's results are published unedited, including what they do not prove.

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

**The final day (18 October): what we decided, and what the assistant did**

- **Check before changing.** The assistant walked the live app in a headless browser at 1440 px and
  375 px: all ten tour steps, a review-agent run, the story 3 correction and the unrelated-medicine edit.
  It found no bugs. We then decided what to change.
- **We broke our own feature freeze once, on purpose, and set a new one.** Our weakest point was that
  three fixed stories can look staged, and that a judge could not see FalkorDB doing the work. Dev
  decided to add one feature, the **patient lab**, under three conditions: the rules in `engine/rules.py`
  stay unchanged, it uses only the existing named write queries, and work stops in time to record the
  demo on a stable build.
- **We chose the honest version of "it needs the graph".** We did not build a fake "graph off" mode.
  The lab writes the visitor's patient to FalkorDB and the same Q1 walk and rules evaluate it. Without
  FalkorDB the endpoint returns `503 graph_required` because there is nothing honest to fall back on.
  The comparison with a flat medicine list is defined openly on the page ("a calcium-channel blocker and
  a diuretic, together"), so a judge can see exactly what it is compared against.
- **We said no to the tempting shortcut.** Supporting more cascades would have made the lab look richer,
  but each new pattern needs a citation, a review and a change to the rules. So the lab uses the one
  curated pattern, and medicines outside it (diltiazem, a thiazide, a statin) are there to show the graph
  correctly finds no chain.
- **Less text.** We asked for shorter copy on the landing and How it works pages, so a judge can follow
  the idea in seconds. The assistant made the edits and screenshotted every page at both widths.
- **The assistant then** wrote the lab API, the page and 16 tests that run on FalkorDB, recorded the
  README GIF headlessly, and drafted the demo script, blog post and submission text. We reviewed and
  edited them, approved each merge to `main` (which deploys), and recorded the video and published the
  blog ourselves.

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
