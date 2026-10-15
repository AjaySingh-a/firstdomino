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
| Investigation + memory | `Question` | `id`, `ask_role`, `text`, `asked_at`, `answer`, `answer_state` |
| | `FindingRevision` | `id`, `n`, `status`, `reason`, `changed_fact_ids`, `created_at`, `eval_version` |
| | `ReviewDecision` | `id`, `by_role`, `decision`, `reason`, `decided_at` |
| | `AgentStep` | `id`, `tool`, `ok`, `args`, `result_ids`, `at` |

## Relationships

| Layer | Relationship | From → To |
|---|---|---|
| Knowledge | `IN_CLASS` | `Ingredient` → `DrugClass` |
| | `INDEX` | `Pattern` → `DrugClass` (first medicine) |
| | `VIA` | `Pattern` → `Effect` |
| | `MARKER` | `Pattern` → `DrugClass` (second medicine) |
| Patient facts | `HAS` | `Patient` → `MedicationEpisode` / `Observation` / `Source` / `Finding`* |
| | `OF` | `MedicationEpisode` → `Ingredient` |
| | `OF_EFFECT` | `Observation` → `Effect` |
| | `FROM_SOURCE` | `MedicationEpisode` / `Observation` → `Source` |
| | `PRESCRIBED_BY` | `MedicationEpisode` → `Prescriber` |
| Reasoning | `FROM` / `TO` | `Finding` → `MedicationEpisode` (index / marker) |
| | `CITES` | `Finding` → `Observation` / `Source` |
| | `MATCHES` | `Finding` → `Pattern` |
| | `NEEDS` | `Finding` → `EvidenceRequirement` |
| | `ABOUT` | `EvidenceRequirement` → fact |
| Investigation + memory | `RESOLVES` | `Question` → `EvidenceRequirement` |
| | `OF` | `FindingRevision` → `Finding` |
| | `PREVIOUS` | `FindingRevision` (n+1) → `FindingRevision` (n) |
| | `ON` | `ReviewDecision` → `FindingRevision` |
| | `FOR` | `AgentStep` → `Finding` |

\* Q2 needs `Patient -[:HAS]-> fact`. **Decided (D-1):** `Patient -[:HAS]-> Finding` is written, and
Q4–Q6 traverse it from `Patient {id: $pid}`, so a finding is reachable only through its own patient.
Q3 still matches `Finding {patient_id: $pid}`.

## Finding statuses

`candidate` · `needs_evidence` · `competing_explanation` · `needs_reassessment` · `reviewed` ·
`not_matched`. None of them means "caused".

Rules on Q1 rows (`engine/rules.py`, tested in `tests/test_rules.py`), in precedence order:

- Two **documented** facts in the reverse of index start → onset → marker start → `not_matched`.
  If either side is only `reported`, the order is not settled: an `order` requirement instead.
- The second medicine has a documented, different indication → `competing_explanation`, shown and not
  dismissed. "Same as the effect" means an exact phrase in `rules.EFFECT_TERMS` (e.g. "ankle swelling").
- Any required fact unknown → `needs_evidence`, with one requirement per gap. A null day is never read
  as 0 or as absent. No observation of the effect at all → an `onset_day` requirement about the index
  episode (`field: via_effect`): not known yet, not "no".
- Conflicting facts → stays `candidate`, with the conflict listed in the revision reason and `conflicts`.
- `window_days` is shown with the pattern but excludes nothing (Savage 2020 saw the association persist
  up to a year).

Finding IDs: `<pid>:fnd-<pattern id without "pat-">-<k>`. Requirements: `<pid>:req-<fact>-<kind>`.
First evaluation writes `FindingRevision` n=1 with `ON CREATE`, so reloading never rewrites history.

When evidence changes under a reviewed finding: create revision n+1 with status `needs_reassessment`
and the reason, linked by `PREVIOUS`. The clinician's decision stays attached to revision n.

## Queries

Named files in `engine/queries/`, loaded with `engine.cypher.load(name)`, always parameterised:

| File | Purpose | Params |
|---|---|---|
| `q1_candidate_match` | candidate rows + fact states for one patient | `$pid` |
| `q2_next_question` | the missing fact the most open findings depend on | `$pid` |
| `q3_dependency_scope` | findings that touch a changed fact (only these re-evaluate) | `$pid`, `$fact_id` |
| `q4_evidence_pack` | evidence for the drawer | `$pid`, `$fid` |
| `q5_review_history` | revisions with decisions kept intact | `$pid`, `$fid` |
| `q6_patient_findings` | findings list with linked IDs (`GET /patients/{id}/findings`) | `$pid` |

Loader and engine writes live in `engine/queries/write/` (MERGE, parameterised), admin reads in
`engine/queries/admin/`. Neither starts from a patient, so `test_contracts` checks only the top level.

**Checked on FalkorDB 4.22 (D-1):** comma-separated multi-patterns, pattern predicates in `WHERE`,
`[:A|B]`, `UNION`, `SET n += $map` (null removes the property), `MERGE … ON CREATE SET`, empty-list
properties and `GRAPH.COPY` all work. `collect([o.id, …])` over an empty `OPTIONAL MATCH` yields
`[[null, …]]`; `engine/rules.py` and `api/graph_store.py` drop those entries.

## Loading

`uv run python -m engine.loaders.seed [--reset] [--family demo] [--stories 1 2 3]` (default: Story 1
into `family_demo`). It MERGEs knowledge into `kb_template`, `GRAPH.COPY`s it to `family_<id>` (or
MERGEs the same knowledge if that graph exists), loads each story, then runs Q1 + rules.

## Dropped from v1

`LIKELY_TRIGGERED` edges · downstream-count "root" ranking · the PageRank cross-check · adverse-event
report weights (FDA says these reports can't establish causation).
