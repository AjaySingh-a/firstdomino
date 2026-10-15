# Data model

FalkorDB holds every fact, finding, question and review, with versions. Deterministic code
(`engine/rules.py`) decides findings. The review agent only picks allowlisted actions and phrases text
around evidence IDs it was given. Types: `api/models.py` (mirrored in `web/lib/types.ts`).

## Graphs

- **One graph per family**: `family_<id>`. Every patient traversal starts from `Patient {id: $pid}`.
  The server checks that the caller may access that patient before running any query.
- **`kb_template`** holds the knowledge layer and is copied into each family graph. It holds up to 6
  curated, cited patterns (`data/patterns/`) and only the ingredients the 3 stories need. Side effects
  extracted from drug labels are drafts for review, never automatic knowledge.
- **IDs are patient-scoped**: `<patient_id>:<local id>`, e.g. `syn-p1:ep-furosemide`,
  `syn-p1:fnd-ccb-edema-loop-1`, `syn-p1:fnd-ccb-edema-loop-1:rev-2`. Pattern IDs are global.

## Time, state and versions

- **Dates are day numbers.** Day 0 is the first event in the story. `null` means not known.
- **Every fact has two timestamps**: `happened_at` (day or `null`) and `recorded_at` (day).
- **Every fact has a state**: `documented`, `reported` (by the caregiver), `conflicting` or `unknown`.
  An answer can also be `not_available`, which is **never treated as "no"**: the value stays empty,
  and the requirement is marked `not_available` rather than `provided`.
- **Versioning**: `Patient.case_version` goes up with every accepted write. A write that carries an old
  version gets HTTP 409. Each evidence change has an `event_id`, so re-sending it is idempotent.
  The check is a compare-and-set inside one FalkorDB query (`write/evidence_apply`, `write/review`).
- **Fact versions**: a confirmed change never overwrites history. The fact node keeps its ID and
  edges and holds the current values plus `version`. Each version is a `FactVersion`
  (`<fact id>:ver-<n>`); the old one is kept with `superseded_at`, and version n+1 `SUPERSEDES` n.

### Naming decision (differs from the plan's section 6)

The plan used `start_day`/`start_state` on `MedicationEpisode` and `onset_day`/`onset_state` on
`Observation`. To satisfy "every fact has `happened_at`, `recorded_at` and `state`", both use the
uniform names in the graph and the API:

| Plan (v2)                         | Graph + API                          |
|-----------------------------------|--------------------------------------|
| `MedicationEpisode.start_day`     | `MedicationEpisode.happened_at`      |
| `MedicationEpisode.start_state`   | `MedicationEpisode.state`            |
| `Observation.onset_day`           | `Observation.happened_at`            |
| `Observation.onset_state`         | `Observation.state`                  |

`indication` / `indication_state` and `stop_day` are unchanged. Q1 in `engine/queries/` uses the new names.

## Labels and properties

| Layer | Label | Properties |
|---|---|---|
| Knowledge | `Ingredient` | `name`, `rxcui` |
| | `DrugClass` | `code` (ATC, e.g. `C08CA`, `C03CA`) |
| | `Effect` | `name` (e.g. `peripheral_edema`) |
| | `Pattern` | `id`, `version`, `title`, `window_days`, `requires`, `evidence_refs` (JSON string: FalkorDB has no map properties) |
| Patient facts | `Patient` | `id`, `label`, `age_band`, `case_version`, `as_of_day`, `synthetic` |
| | `Prescriber` | `id` (`<pid>:prs-<specialty>`, patient-scoped so no node is shared), `specialty` |
| | `Source` | `id`, `kind`, `label`, `happened_at`, `recorded_at` |
| | `MedicationEpisode` | `id`, `happened_at`, `recorded_at`, `state`, `dose_text`, `indication`, `indication_state`, `stop_day` |
| | `Observation` | `id`, `happened_at`, `recorded_at`, `state`, `label` |
| Reasoning | `Finding` | `id`, `patient_id`, `status`, `revision_n`, `pattern_version`, `eval_version`, `headline` |
| | `EvidenceRequirement` | `id`, `patient_id`, `finding_id`, `kind` (`start_day`/`onset_day`/`indication`/`order`), `field`, `state` (`missing`/`provided`/`not_available`) |
| Investigation + memory | `Question` | `id`, `patient_id`, `requirement_id`, `ask_role`, `text`, `asked_at`, `answer`, `answer_state` (written by `POST /questions`) |
| | `FindingRevision` | `id`, `n`, `status`, `reason`, `changed_fact_ids`, `created_at`, `eval_version` |
| | `ReviewDecision` | `id`, `patient_id`, `finding_id`, `revision_n`, `by_role`, `decision`, `reason`, `decided_at` |
| | `FactVersion` | `id` (`<fact id>:ver-<n>`), `fact_id`, `n`, the fact's stored properties and `source_ids` at that version, `superseded_at`, `event_id` |
| | `EvidenceEvent` | `id` (the request's `event_id`), `patient_id`, `status` (`pending`/`applying`/`applied`), `case_version`, `change`, `before`, `after`, `findings_before` and `result` (JSON strings), `recorded_at` |
| | `AgentStep` | `id`, `patient_id`, `tool`, `ok`, `args_json` (FalkorDB stores no maps), `result_ids`, `at`, `seq` |

## Relationships

| Layer | Relationship | From → To |
|---|---|---|
| Knowledge | `IN_CLASS` | `Ingredient` → `DrugClass` |
| | `INDEX` | `Pattern` → `DrugClass` (first medicine) |
| | `VIA` | `Pattern` → `Effect` |
| | `MARKER` | `Pattern` → `DrugClass` (second medicine) |
| Patient facts | `HAS` | `Patient` → `MedicationEpisode` / `Observation` / `Source` / `Finding`* / `EvidenceEvent` / `Question` / `AgentStep` |
| | `OF` | `MedicationEpisode` → `Ingredient` |
| | `OF_EFFECT` | `Observation` → `Effect` |
| | `FROM_SOURCE` | `MedicationEpisode` / `Observation` → `Source` |
| | `PRESCRIBED_BY` | `MedicationEpisode` → `Prescriber` |
| Reasoning | `FROM` / `TO` | `Finding` → `MedicationEpisode` (index / marker) |
| | `CITES` | `Finding` → `Observation` / `Source` |
| | `MATCHES` | `Finding` → `Pattern` |
| | `NEEDS` | `Finding` → `EvidenceRequirement` |
| | `ABOUT` | `EvidenceRequirement` → fact |
| Investigation + memory | `RESOLVES` | `Question` → `EvidenceRequirement` it was asked for (Q2 then skips that requirement) |
| | `OF` | `FindingRevision` → `Finding` |
| | `PREVIOUS` | `FindingRevision` (n+1) → `FindingRevision` (n) |
| | `ON` | `ReviewDecision` → `FindingRevision` |
| | `BECAUSE` | `FindingRevision` → `EvidenceEvent` that caused it |
| | `VERSION` | `MedicationEpisode` / `Observation` → `FactVersion` |
| | `SUPERSEDES` | `FactVersion` (n+1) → `FactVersion` (n) |
| | `RECORDED` | `EvidenceEvent` → the `FactVersion` it created |
| | `FOR` | `AgentStep` → `Finding` |

\* Q2 needs `Patient -[:HAS]-> fact`. **Decided (D-1):** `Patient -[:HAS]-> Finding` is written, and
Q3–Q6 traverse it from `Patient {id: $pid}`, so a finding is reachable only through its own patient.

## Finding statuses

`candidate` · `needs_evidence` · `competing_explanation` · `needs_reassessment` · `reviewed` ·
`not_matched`. None of them means "caused".

Rules on Q1 rows (`engine/rules.py`, tested in `tests/test_rules.py`), in precedence order:

- Two **documented** facts in the reverse of index start → onset → marker start → `not_matched`.
  If either side is only `reported`, the order is not settled: an `order` requirement instead.
- The second medicine has a known indication that is not the pattern's effect → `competing_explanation`,
  shown and not dismissed, whether that reason is `documented` or `reported` (the headline and reason
  say which: "has a different reported reason", "is reported by the caregiver as …"). A reported
  different reason never leaves the finding `candidate`. "Same as the effect" means an exact phrase in
  `rules.EFFECT_TERMS` (e.g. "ankle swelling"). The text never says the prescribing was wrong: it is
  another explanation worth reviewing alongside the pattern. (`EVAL_VERSION` 2.)
- Any required fact unknown → `needs_evidence`, with one requirement per gap. A null day is never read
  as 0 or as absent. No observation of the effect at all → an `onset_day` requirement about the index
  episode (`field: via_effect`): not known yet, not "no".
- Conflicting facts → stays `candidate`, with the conflict listed in the revision reason and `conflicts`.
- `window_days` is shown with the pattern but excludes nothing (Savage 2020 saw the association persist
  up to a year).

Finding IDs: `<pid>:fnd-<pattern id without "pat-">-<k>`. Requirements: `<pid>:req-<fact>-<kind>`.
First evaluation writes `FindingRevision` n=1 with `ON CREATE`, so reloading never rewrites history.

When evidence changes (`api/graph_store.py`, `engine/evaluate.reevaluate`):

1. Q3 (`q3_affected`) finds the findings that cite, link or need the changed fact. Only those re-run
   the rules; a change to any other fact reopens nothing.
2. Each affected finding gets revision n+1 with the reason (what changed, then the rules' view) and
   `changed_fact_ids`, linked by `PREVIOUS` to n and by `BECAUSE` to the event.
3. If the finding has a review decision, the new revision is `needs_reassessment` and the decision
   stays on the revision it was made on. Otherwise the status is what the rules now say.
4. Requirements follow the rules: a gap that closed becomes `provided`, a new or reopened gap is
   `missing`. A `not_available` answer marks the requirement `not_available` and it stays that way
   while the gap is open: never read as "no", never asked again.

Reasons and change summaries never show Python's `None`: a missing value reads "not recorded".

The `EvidenceEvent` is written as `applying` in the same query as the fact change, holding the fact
before and after and the findings before. Steps 1-4 then run and the event becomes `applied` with its
result. If the API stops in between, re-sending the same `event_id` resumes steps 1-4 from the event
(each is idempotent; a revision already linked to the event by `BECAUSE` is reused) instead of 409.

## Queries

Named files in `engine/queries/`, loaded with `engine.cypher.load(name)`, always parameterised:

| File | Purpose | Params |
|---|---|---|
| `q1_candidate_match` | candidate rows + fact states for one patient | `$pid` |
| `q2_next_question` | the missing fact the most open findings depend on | `$pid` |
| `q3_affected` | findings that cite, link or need a changed fact (only these re-evaluate) | `$pid`, `$fact_id` |
| `q4_evidence_pack` | evidence for the drawer | `$pid`, `$fid` |
| `q5_history` | full history: revisions, `PREVIOUS`, decisions on their revision, events behind each | `$pid`, `$fid` |
| `q6_patient_findings` | findings list with linked IDs (`GET /patients/{id}/findings`) | `$pid` |
| `q7_timeline` | current facts, sources, pending evidence (`GET /patients/{id}/timeline`) | `$pid` |
| `q8_evidence_event` | one evidence event, for idempotent replay or resuming an `applying` one | `$pid`, `$event_id` |
| `q9_requirements` | requirements, what each is about, and the `Question` asked for it (`POST /questions`, asked questions in the drawer) | `$pid` |
| `q10_agent_steps` | the review agent's steps, oldest first (`GET /patients/{id}/agent-steps`) | `$pid` |

Loader and engine writes live in `engine/queries/write/` (MERGE, parameterised), admin reads in
`engine/queries/admin/`. Neither starts from a patient, so `test_contracts` checks only the top level.

**Checked on FalkorDB 4.22 (D-1):** comma-separated multi-patterns, pattern predicates in `WHERE`,
`[:A|B]`, `UNION`, `SET n += $map` (null removes the property), `MERGE … ON CREATE SET`, empty-list
properties and `GRAPH.COPY` all work. `collect([o.id, …])` over an empty `OPTIONAL MATCH` yields
`[[null, …]]`; `engine/rules.py` and `api/graph_store.py` drop those entries.

## Loading

`uv run python -m engine.loaders.seed [--reset] [--family demo] [--stories 1 2 3]` (default: Story 1
into `family_demo`). It MERGEs knowledge into `kb_template`, `GRAPH.COPY`s it to `family_<id>` (or
MERGEs the same knowledge if that graph exists), loads each story, runs Q1 + rules, then loads the
story's earlier review decisions, agent steps and pending evidence. A patient already in the graph is skipped: the
graph is the record, and the fixture must not overwrite evidence confirmed since (`--reset` starts
over). The API runs the same seed on start, so it only ever adds missing stories.

## Dropped from v1

`LIKELY_TRIGGERED` edges · downstream-count "root" ranking · the PageRank cross-check · adverse-event
report weights (FDA says these reports can't establish causation).
