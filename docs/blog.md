---
title: "FirstDomino: finding prescribing cascades as a walk through a graph"
subtitle: "What we built for Graph Hacks 2026 with FalkorDB, and what we deliberately did not build"
tags: falkordb, graphdatabase, healthtech, ai, hackathon
---

# FirstDomino: finding prescribing cascades as a walk through a graph

*All patient data in this post and in the project is synthetic. FirstDomino is a hackathon prototype.
It is not a medical device and it has not been clinically validated.*

## The problem: a side effect that looks like a new illness

An older person starts amlodipine for blood pressure. A few weeks later their ankles swell, which is a
known side effect. At a different visit, with a different doctor, the swelling is treated with
furosemide, a water tablet. Now there are two medicines, and the second may exist only because of the
first.

This is a **prescribing cascade**. No single step looks wrong. The pattern only shows up when someone
lines up the whole story: the clinic letter, the pharmacy record, the hospital discharge, and what the
family remembers. That story is almost never in one place.

The problem is well documented. In 2022, an international panel (ThinkCascades) agreed on nine
clinically important cascades in older adults. In 2025, a second panel listed 65 potentially
inappropriate ones. A 2026 *BMJ* study of about 2.3 million older adults in Ontario found 24 of them to
be common and closely timed. The research exists. What a pharmacist doing a medication review lacks is
a way to see the chain in one patient's messy record, and to know which single missing fact would
settle it.

So we set one rule for ourselves. FirstDomino reports **possible patterns** worth a clinician's review.
It never says one medicine caused another, and it never suggests changing a medicine. That decision
belongs to the prescribing clinician.

## Why a graph, and not a table

A cascade is a path: a medicine, then its class, then a published pattern, then a side effect, then a
symptom the patient had, then a second medicine in another class. In FalkorDB that path is one query.

**Q1 finds the chain.** It starts from the patient, as every query in the project does:

```cypher
MATCH (p:Patient {id: $pid})-[:HAS]->(a:MedicationEpisode)-[:OF]->(:Ingredient)
      -[:IN_CLASS]->(:DrugClass)<-[:INDEX]-(pat:Pattern),
      (pat)-[:MARKER]->(:DrugClass)<-[:IN_CLASS]-(:Ingredient)<-[:OF]-(b:MedicationEpisode)<-[:HAS]-(p),
      (pat)-[:VIA]->(e:Effect)
OPTIONAL MATCH (p)-[:HAS]->(o:Observation)-[:OF_EFFECT]->(e)
RETURN a, b, e, collect(o) AS observations
```

The match goes through the drug **class**, not the drug name. Nifedipine and felodipine match the same
pattern as amlodipine. Diltiazem doesn't: it is also called a calcium-channel blocker, but it sits in a
different ATC class, and the cited studies are about the other class. A keyword list can't tell them
apart. An `IN_CLASS` edge can.

Q1 only gathers facts and how sure each one is. It never decides anything. Deterministic, tested Python
rules (`engine/rules.py`) set the status: `candidate`, `needs_evidence`, `competing_explanation`,
`not_matched`, and so on.

**Q2 picks the next question.** Where a fact is missing, the rules write an `EvidenceRequirement`
linked to that fact. Q2 counts how many open findings are waiting on each missing fact and returns the
one that unblocks the most:

```cypher
MATCH (p:Patient {id: $pid})-[:HAS]->(fact)<-[:ABOUT]-(r:EvidenceRequirement {state: 'missing'})
      <-[:NEEDS]-(f:Finding)
WHERE NOT (r)<-[:RESOLVES]-(:Question)
WITH fact, r, count(DISTINCT f) AS findings_waiting
RETURN fact.id, r.kind, findings_waiting ORDER BY findings_waiting DESC LIMIT 1
```

**Q3 keeps re-evaluation local.** When a fact changes, Q3 follows edges back from that fact to the
findings that cite it, link to it, or need it. Only those findings are evaluated again:

```cypher
MATCH (p:Patient {id: $pid})-[:HAS]->(fact {id: $fact_id})
MATCH (p)-[:HAS]->(f:Finding)-[:CITES|FROM|TO]->(fact) RETURN f.id
UNION
MATCH (p:Patient {id: $pid})-[:HAS]->(fact {id: $fact_id})
MATCH (p)-[:HAS]->(f:Finding)-[:NEEDS]->(:EvidenceRequirement)-[:ABOUT]->(fact) RETURN f.id
```

In the demo, changing the start date of atorvastatin (a statin no pattern uses) reopens nothing: no
re-check, no new version. Correcting the swelling date reopens exactly one finding.

We didn't want to just say the graph matters, so the app has a **patient lab**. You place medicines and
a symptom on a timeline. The API writes them to FalkorDB as a new synthetic patient and runs the same
queries and rules, and the page shows each step's time against the live graph. It takes milliseconds.
Next to the result, the page shows what a flat medicine list would say about the same list. Put
furosemide before amlodipine and the flat list still flags the pair, while the graph says the order
doesn't fit. Without FalkorDB, the lab endpoint returns `503 graph_required`. We didn't write a fallback
because there is nothing honest to fall back to.

## The evidence model: "not known" is not "no"

Medical records are incomplete, late and sometimes contradictory, and the data model had to say so.

- **Every fact has a state:** `documented`, `reported` (by the caregiver), `conflicting` or `unknown`.
  It also has two timestamps: when it happened, and when it was recorded.
- **Unknown is never absent.** A missing start day becomes a requirement to ask about, never a zero.
  A caregiver who answers "I don't know" is stored as `not_available`, and that is never read as "no".
- **Nothing is overwritten.** A corrected fact gets a new `FactVersion` that `SUPERSEDES` the old one.
  An affected finding gets `FindingRevision` n+1, linked by `PREVIOUS` to the one before.
- **Decisions stay where they were made.** If a clinician reviewed revision 1 and a late GP note then
  moves a date, revision 2 becomes `needs_reassessment`. The clinician's decision stays attached to
  revision 1, the evidence they actually saw.
- **Stale or repeated writes are caught.** Every write carries a `case_version` and checks it inside
  one query, so a stale write gets HTTP 409. Every evidence event has an idempotent `event_id`. If the
  API dies halfway through, re-sending the event resumes the work instead of doing it twice.

This is where FalkorDB is shared memory for three roles that keep no state of their own: the caregiver
(facts), the pharmacist and the review agent (questions, agent steps), and the clinician (decisions on
a specific revision).

## A bounded agent

The review agent gets one pass over one finding: at most six steps, from six allowlisted tools (read
the evidence, inspect an episode, find the next missing fact, record that a question was asked, see
which findings depend on a fact, draft the packet).

Its guards are code, not prompt wording:

- **The LLM never creates findings.** Only the rules do. The agent can't answer a question, change a
  fact or record a decision.
- **Every reply is checked.** It must be valid JSON naming an allowed tool. Its arguments and cited IDs
  must come from earlier tool results. Its text may not introduce days, dates, medicines or reasons
  that aren't in the results, and may not use certainty words like "confirmed".
- **Templates are the fallback.** A rejected reply, a rate limit or a timeout gets one retry, then
  deterministic templates. The reason is recorded on the step, and every step is saved in the graph as
  an `AgentStep`.

We run the LLM on Groq's free tier, so the demo occasionally falls back to templates. The outcome is
the same and the wording is plainer.

The same read-only tools are also available to Claude Desktop through an MCP server that calls the HTTP
API and never the graph directly.

## The proof, and what it does not prove

- **12 of 12 synthetic cases** (98 of 98 checks) agree with their documented expectations when run on
  the graph engine. The cases were written from `docs/data-model.md`, not from the rules code.
- **We tested the runner too.** We deliberately made five expectations wrong, and all five were
  reported as disagreements.
- **The restart test** confirms story 3's correction and a second review, restarts both the FalkorDB
  and API containers, and checks that everything reads back identically. FalkorDB runs with AOF on.

This shows the engine does what its documentation says. It is **not** clinical accuracy. The cases
were written by the same team that built the engine.

## Limitations

- **One curated pattern so far** (calcium-channel blocker → ankle swelling → loop diuretic). The model
  is built for more, but each pattern needs a citation and a careful review, and we didn't rush that.
- **Synthetic data only, no clinical validation**, and no authentication. The server only checks that
  the patient exists in the family graph.
- **The 90-day window is shown but excludes nothing,** because the published association lasts longer.

## Links

- **Live app:** https://firstdomino-web.vercel.app (try the 2-minute tour, then the patient lab)
- **API health:** https://api-production-b29f.up.railway.app/health
- **Code:** https://github.com/AjaySingh-a/firstdomino
- **Demo video:** VIDEO_LINK

Built by team Kodeline (Ajay Singh, Dev Grover) for Graph Hacks 2026, WeMakeDevs × FalkorDB.
