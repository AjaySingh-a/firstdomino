---
title: "Every prescription looked reasonable. The chain didn't."
published: true
description: How we used FalkorDB to find prescribing cascades as one walk through a graph, with a review agent that is not allowed to decide anything.
tags: falkordb, ai, showdev, hackathon
cover_image: https://raw.githubusercontent.com/AjaySingh-a/firstdomino/main/docs/blog-cover.png
---

*All patient data in this post is synthetic. FirstDomino is a hackathon prototype, not a medical device, and it has not been clinically validated.*

Day 0: an older woman starts **amlodipine**, a common blood pressure pill.
Day 21: her ankles swell. That is a known side effect of amlodipine.
Day 35: at a different visit, with a different doctor, the swelling is treated with **furosemide**, a water pill.

Every prescription looked reasonable. But the second medicine may exist only because of the first. This is a **prescribing cascade**: a side effect gets mistaken for a new illness and treated with another medicine. No single step looks wrong. You only see it when the whole story is laid out in order, and that story is usually spread across several records.

It is common. An international panel (ThinkCascades, 2022) agreed on nine important cascades in older adults. A second panel listed 65 potentially inappropriate ones (the PIPC list), and a 2026 *BMJ* study of about 2.3 million older adults in Ontario found 24 of them to be common and closely timed.

For Graph Hacks we built **FirstDomino**. It finds that chain in one patient's record as a single walk through a FalkorDB graph, and asks for the one missing fact a clinician needs to review it.

{% embed https://youtu.be/2DeOnoqJeyY %}

## Try it in 60 seconds

Open the **patient lab** (https://firstdomino-web.vercel.app/lab), pick a preset and click **Write to the graph and walk it**. A new synthetic patient is written to FalkorDB, with each query timed.

- **Reason not recorded:** amlodipine, then swelling, then furosemide with no reason on record. You get a possible pattern and one question to ask.
- **Wrong order:** furosemide first, amlodipine later. The graph still connects the two medicines, but the rules say the order doesn't fit.
- **A lookalike medicine:** diltiazem instead of amlodipine. The graph finds no path at all.

## What it does

- **The pharmacist reviews** the medication story, the possible pattern and its evidence: documented, reported, or not known yet.
- **The caregiver answers.** FirstDomino asks them for one missing fact, such as why furosemide was started.
- **The clinician decides.** FirstDomino reports *possible patterns worth reviewing*. It never suggests changing a medicine; that is the prescribing clinician's call.

## Why a graph, not a table

A graph stores things as **nodes** (a patient, a medicine, a symptom) and the links between them as **edges** (this patient HAS this medicine, this medicine is IN_CLASS of that family). You query it with **Cypher**, the query language for graphs, by drawing the shape you're looking for.

A cascade is a shape: medicine → its ingredient → its **drug class** (a family of similar medicines) → a cited pattern → another drug class → ingredient → second medicine. In FalkorDB that is one query. Here is the core of Q1, and like every query in the project it starts from one patient:

```cypher
MATCH (p:Patient {id: $pid})-[:HAS]->(a:MedicationEpisode)-[:OF]->(ai:Ingredient)
      -[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pat:Pattern),
      (pat)-[:MARKER]->(:DrugClass)<-[:IN_CLASS]-(bi:Ingredient)<-[:OF]-(b:MedicationEpisode)<-[:HAS]-(p),
      (pat)-[:VIA]->(e:Effect)
OPTIONAL MATCH (p)-[:HAS]->(o:Observation)-[:OF_EFFECT]->(e)
```

The walk goes through the **class**, not the name. Nifedipine and felodipine match the same pattern as amlodipine. Diltiazem doesn't. It is also called a calcium-channel blocker, but it sits in a different ATC class (`C08DB`, not `C08CA`), and the cited studies are about amlodipine's class. A keyword list can't tell them apart. An `IN_CLASS` edge can.

Q1 only collects facts and how sure each one is. Tested Python rules (`engine/rules.py`) set the status: `needs_evidence`, `candidate`, `competing_explanation`, `not_matched` and so on. The graph finds; the rules decide.

## The path comes from the graph

We didn't want the screen to draw a chain the database never returned. So Q11 asks FalkorDB for the walk itself, and the API hands back `nodes(path)` and `relationships(path)` in order. The web app draws exactly that: **7 nodes, 6 relationships**, plus a side branch from the pattern's effect to the symptom the caregiver reported.

![The patient lab: a new synthetic patient written to FalkorDB, with the walk drawn from the path the query returned and each step's time](https://raw.githubusercontent.com/AjaySingh-a/firstdomino/main/evidence/2026-10-18/lab-chain-1440.png)

In the wrong order, the path is still there but the status is `not_matched`. The path explains; the rules decide.

## Proving a link is NOT there

Finding a chain is half the job. The other half is showing that one isn't there. Q12 hands two medicines to FalkorDB's shortest-path algorithm and only lets it walk the knowledge edges, never the patient:

```cypher
CALL {
  WITH a, b
  CALL algo.SPpaths({sourceNode: a, targetNode: b,
                     relTypes: ['OF', 'IN_CLASS', 'INDEX', 'MARKER'],
                     relDirection: 'both', maxLen: 8, pathCount: 1}) YIELD path
  RETURN collect(path) AS paths
}
```

For amlodipine and furosemide it finds the 7-node path through the pattern. For **diltiazem and furosemide it finds nothing**, because no edge leads from diltiazem's class to the pattern. A flat list ("calcium-channel blocker + water pill") still flags the pair, and the lab shows both answers side by side.

![The lookalike preset: algo.SPpaths finds no path from diltiazem to furosemide, while a flat name check still flags the pair](https://raw.githubusercontent.com/AjaySingh-a/firstdomino/main/evidence/2026-10-18/lab-lookalike-1440.png)

One honest caveat, which the app also shows: **no chain does not mean nothing is wrong.** FirstDomino models one curated pattern, so a clinician still reviews the whole medicine list.

## Memory you can see

FalkorDB is the shared memory for the caregiver, the pharmacist with the agent, and the clinician.

- **Questions and agent steps are nodes** (`Question`, `AgentStep`). On a second run the agent reads them first and, instead of asking again, says **"answered from memory"**: asked in run 1, still waiting for the caregiver.
- **Q2 picks the next question.** Each missing fact is an `EvidenceRequirement`. Q2 counts how many open findings wait on each one and returns the fact that unblocks the most.
- **Nothing is overwritten.** A corrected fact gets a new `FactVersion` linked to the old one by `SUPERSEDES`. The finding gets a new `FindingRevision` linked by `PREVIOUS`.
- **Decisions stay on their revision.** If a clinician reviewed revision 1 and a late GP note then moves a date, revision 2 becomes `needs_reassessment`. The decision stays on revision 1, the evidence the clinician actually saw.
- **Q3 re-checks only what changed.** When a fact changes, Q3 walks back from it to the findings that depend on it. Changing a statin's start date re-checks nothing. Correcting the swelling date re-checks exactly one finding.
- **It survives a restart.** FalkorDB runs with AOF (append-only file) persistence, and a test restarts it to prove nothing is lost.

![The caregiver answers the missing fact: the dashed edge turns solid, the finding moves to version 2, and only that finding is re-checked](https://raw.githubusercontent.com/AjaySingh-a/firstdomino/main/docs/media/demo.gif)

## An agent that isn't allowed to decide

The review agent gets one pass over one finding. Its rules are code, not prompt wording:

- **Six allowlisted tools:** read the evidence pack, inspect one medicine, find the next missing fact, ask a question, see which findings depend on a fact, and prepare the packet. It never writes Cypher.
- **At most six steps.** Then it stops.
- **Every reply is checked.** It must be valid JSON naming an allowed tool, every ID must come from an earlier tool result, and its text can't add days, medicines or reasons, or certainty words like "confirmed".
- **Templates are the fallback.** A bad reply, a rate limit or a timeout gets a retry, then deterministic templates, with the reason recorded. We run the LLM on Groq's free tier, so this happens, and the outcome is the same in plainer words.
- **Every step is saved** in the graph as an `AgentStep`, failures included.

The LLM never creates a finding or records a decision. The same read-only tools are also available in Claude Desktop through our MCP server, which calls the HTTP API, never the graph.

## What FalkorDB handled for us

| What we needed | What FalkorDB gave us |
|---|---|
| Keep each family's data apart | One graph per family, chosen with `select_graph`, so there is no `WHERE family = …` to forget |
| Find the chain | Cypher pattern matching through drug classes in one query |
| Prove a link is absent | `algo.SPpaths`, a built-in shortest-path algorithm |
| Stop two people overwriting each other | `MERGE` and a compare-and-set on `case_version` in one query; a stale write gets HTTP 409 |
| Keep answers across a crash | AOF persistence, reported by our `/health` endpoint |
| See the real graph | FalkorDB Browser, which we used to check every query by eye |

## What broke along the way (the useful part)

**1. Railway stopped deploying `main`.** Merges built nothing. The service's saved source had the repo but no branch, so there was no push trigger. `railway add --branch` hadn't stuck. We now connect the source with an explicit `--branch main` and check the live API after every merge. ([docs/deploy.md](https://github.com/AjaySingh-a/firstdomino/blob/main/docs/deploy.md), commit [7a99cee](https://github.com/AjaySingh-a/firstdomino/commit/7a99cee))

**2. The agent sent a stale `case_version` and got a 409.** Right after a caregiver answer, the page reloads the case first and the investigation a moment later. Clicking **Run review agent** in that gap sent the old version, and our own conflict check rejected it. On a local production build, the guided tour failed at step 7 every time. The button now stays disabled until both versions agree. ([PR #22](https://github.com/AjaySingh-a/firstdomino/pull/22))

**3. `collect()` over an empty `OPTIONAL MATCH` isn't empty.** With no symptom on record, `collect([o.id, o.happened_at, …])` returned `[[null, null, …]]`, a list holding one empty entry. The rules now drop entries whose id is null. ([q1_candidate_match.cypher](https://github.com/AjaySingh-a/firstdomino/blob/main/engine/queries/q1_candidate_match.cypher))

**4. No path meant no row.** When `algo.SPpaths` found nothing, the whole row vanished, including the two drug classes we wanted to show next to "no path". Wrapping the call in a `CALL {}` subquery that collects the paths keeps one row with an empty list. ([q12_medicine_link.cypher](https://github.com/AjaySingh-a/firstdomino/blob/main/engine/queries/q12_medicine_link.cypher), commit [3266f30](https://github.com/AjaySingh-a/firstdomino/commit/3266f30))

**5. Cloudflare blocked our agent's user agent.** Calls to Groq from Python's built-in `urllib` came back as 403 (Cloudflare error 1010), because of its default `Python-urllib` user agent. Sending our own user agent fixed it. ([agent/llm.py](https://github.com/AjaySingh-a/firstdomino/blob/main/agent/llm.py), commit [0d94607](https://github.com/AjaySingh-a/firstdomino/commit/0d94607))

## Proof, and what it does not prove

- **12 of 12 synthetic cases** (98 of 98 checks) agree with their documented expectations when run on the graph engine. The cases were written from our data-model doc, not from the rules code.
- **We tested the test runner.** We made five expectations wrong on purpose, and it reported all five.
- **The restart test** restarts FalkorDB and the API after story 3's correction and checks that everything reads back the same.
- The saved outputs from our final live check are in the [evidence folder](https://github.com/AjaySingh-a/firstdomino/tree/main/evidence/2026-10-18).

This shows the engine does what its documentation says. **It is not clinical validation.** The same team wrote the cases and the engine.

## What it doesn't do

- **One curated pattern** (calcium-channel blocker → ankle swelling → loop diuretic). The model is built for the 65 PIPC cascades, but each needs a citation and careful review.
- **Synthetic data only.** There's no authentication and no clinical study.
- **The 90-day window is shown but excludes nothing,** because the published association lasts longer.
- **The algorithm proves a connection or its absence.** It doesn't weigh evidence. The rules decide every status.

## Try it

- **Live app:** https://firstdomino-web.vercel.app (take the 2-minute guided tour)
- **Patient lab:** https://firstdomino-web.vercel.app/lab
- **API health:** https://api-production-b29f.up.railway.app/health

{% github AjaySingh-a/firstdomino %}

**A challenge for you:** open the patient lab and try to build a patient the graph gets wrong. Tell us in the comments.

## Team

- **Dev Grover:** engine, queries, API
- **Ajay Singh:** web app, review agent, MCP server

Built for Graph Hacks by WeMakeDevs × FalkorDB.
