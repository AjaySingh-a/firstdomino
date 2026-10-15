# API

Base URL: `http://localhost:8000`. Types: `api/models.py` = `web/lib/types.ts`. OpenAPI: `/docs`.
By default (`FD_STORE=fixtures`) every route serves the synthetic fixtures in `data/stories/`
through `api/store.py`. With `FD_STORE=graph` (plus `FD_FAMILY`, default `demo`, and `FD_STORIES`,
default `1`) findings, investigation, packet and patients come from FalkorDB (`api/graph_store.py`,
seeded on first start); the timeline is still read from the fixtures, and the two writes return
**501** until D-2. Full responses for every patient are in `data/snapshots/fixtures.json`
(regenerate with `make snapshots`). Examples below come from those snapshots, trimmed (`…`).

Conventions: IDs are patient-scoped (`syn-p1:…`), days are integers, and every write carries
`case_version`.

## Errors

| Status | Body | When |
|---|---|---|
| 404 | `{"error": "not_found", "detail": "patient nobody"}` | unknown patient, finding or fact |
| 409 | `{"error": "stale_case_version", "patient_id": "syn-p3", "sent": 3, "current": 4}` | write carries an old `case_version` |
| 409 | `{"error": "stale_revision", "patient_id": "syn-p1", "sent": 0, "current": 1}` | review targets an old revision |
| 501 | `{"error": "not_implemented", "detail": "review writes move into FalkorDB in D-2"}` | a write in graph mode (until D-2) |
| 422 | `{"error": "invalid", "detail": "event_id syn-p1:evt-x is not scoped to syn-p3"}` | bad field, source or event scope (pydantic errors also use 422) |

---

## GET /health

```json
{ "status": "ok", "mode": "fixtures", "falkordb": "not_used" }
```

## GET /patients

Not in the original brief; added so the web app can list the synthetic patients.

```json
[
  { "id": "syn-p1", "label": "Synthetic patient A", "age_band": "75-79", "case_version": 2, "as_of_day": 60, "synthetic": true },
  { "id": "syn-p2", "label": "Synthetic patient B", "age_band": "80-84", "case_version": 2, "as_of_day": 60, "synthetic": true },
  { "id": "syn-p3", "label": "Synthetic patient C", "age_band": "70-74", "case_version": 4, "as_of_day": 62, "synthetic": true }
]
```

## GET /patients/{id}/timeline

Facts for the SVG timeline, plus `pending_evidence`: changes that have been received but not yet confirmed.

```json
{
  "patient": { "id": "syn-p1", "label": "Synthetic patient A", "age_band": "75-79", "case_version": 2, "as_of_day": 60, "synthetic": true },
  "sources": [
    { "id": "syn-p1:src-cardio-d0", "patient_id": "syn-p1", "kind": "clinic_letter", "label": "Cardiology clinic letter (synthetic)", "happened_at": 0, "recorded_at": 0 },
    "…"
  ],
  "episodes": [
    {
      "id": "syn-p1:ep-furosemide", "patient_id": "syn-p1",
      "happened_at": 35, "recorded_at": 35, "state": "documented",
      "source_ids": ["syn-p1:src-pharm-d35"],
      "ingredient": { "name": "furosemide", "rxcui": "4603", "drug_class": "C03CA" },
      "dose_text": "20 mg once daily",
      "indication": null, "indication_state": "unknown",
      "stop_day": null, "prescriber_specialty": "general_practice"
    },
    "…"
  ],
  "observations": [
    {
      "id": "syn-p1:obs-ankle-swelling", "patient_id": "syn-p1",
      "happened_at": 21, "recorded_at": 60, "state": "reported",
      "source_ids": ["syn-p1:src-cg-d60"], "label": "Ankle swelling", "effect": "peripheral_edema"
    }
  ],
  "pending_evidence": []
}
```

## GET /patients/{id}/findings

```json
{
  "patient_id": "syn-p1",
  "case_version": 2,
  "findings": [
    {
      "id": "syn-p1:fnd-ccb-edema-loop-1", "patient_id": "syn-p1",
      "pattern_id": "pat-ccb-edema-loop", "pattern_version": 1, "eval_version": 1,
      "status": "needs_evidence", "revision_n": 1,
      "index_episode_id": "syn-p1:ep-amlodipine", "marker_episode_id": "syn-p1:ep-furosemide",
      "effect": "peripheral_edema",
      "observation_ids": ["syn-p1:obs-ankle-swelling"],
      "cited_source_ids": ["syn-p1:src-cardio-d0", "syn-p1:src-pharm-d35", "syn-p1:src-cg-d60"],
      "requirement_ids": ["syn-p1:req-furosemide-indication"],
      "headline": "Possible pattern: amlodipine, then ankle swelling, then furosemide"
    }
  ]
}
```

## GET /findings/{id}/investigation

The drawer. Each `FactRef` is one field of one fact:

- `documented` holds facts that are `documented` **or** `reported`; each one carries its own `state`, so show the difference.
- `conflicts` holds `conflicting` facts.
- `unknowns` holds `unknown` / `not_available` facts and anything with an open requirement.

`query_trace` names the `engine/queries/*.cypher` files behind the answer, with `result_ids`: the fact,
requirement or revision IDs each query returned. `mode` is `live` in graph mode.

```json
{
  "patient_id": "syn-p1",
  "case_version": 2,
  "finding": { "id": "syn-p1:fnd-ccb-edema-loop-1", "status": "needs_evidence", "…": "…" },
  "pattern": {
    "id": "pat-ccb-edema-loop", "version": 1,
    "title": "Calcium-channel blocker, then leg or ankle swelling, then a loop diuretic",
    "index_class": "C08CA", "via_effect": "peripheral_edema", "marker_class": "C03CA",
    "window_days": 90, "requires": ["start_day", "onset_day", "indication", "order"],
    "evidence_refs": [{ "citation": "Savage RD, et al. … JAMA Intern Med. 2020;180(5):643-651.", "doi": "10.1001/jamainternmed.2019.7087", "url": "…", "note": "…" }]
  },
  "documented": [
    { "fact_id": "syn-p1:ep-amlodipine", "field": "happened_at", "label": "amlodipine started", "value": 0, "state": "documented", "happened_at": 0, "source_ids": ["syn-p1:src-cardio-d0"], "requirement_id": null },
    { "fact_id": "syn-p1:ep-furosemide", "field": "happened_at", "label": "furosemide started", "value": 35, "state": "documented", "happened_at": 35, "source_ids": ["syn-p1:src-pharm-d35"], "requirement_id": null },
    { "fact_id": "syn-p1:obs-ankle-swelling", "field": "happened_at", "label": "Ankle swelling began", "value": 21, "state": "reported", "happened_at": 21, "source_ids": ["syn-p1:src-cg-d60"], "requirement_id": null }
  ],
  "conflicts": [],
  "unknowns": [
    { "fact_id": "syn-p1:ep-furosemide", "field": "indication", "label": "Reason furosemide was started", "value": null, "state": "unknown", "happened_at": 35, "source_ids": ["syn-p1:src-pharm-d35"], "requirement_id": "syn-p1:req-furosemide-indication" }
  ],
  "next_question": {
    "id": "syn-p1:q-furosemide-indication", "patient_id": "syn-p1",
    "requirement_id": "syn-p1:req-furosemide-indication", "ask_role": "caregiver",
    "text": "Do you know why the water tablet (furosemide) was started around day 35? …",
    "asked_at": null, "answer": null, "answer_state": null
  },
  "sources": ["…"],
  "revisions": [
    { "id": "syn-p1:fnd-ccb-edema-loop-1:rev-1", "n": 1, "status": "needs_evidence", "reason": "First evaluation. …", "changed_fact_ids": [], "created_at": 60, "previous_n": null, "eval_version": 1, "…": "…" }
  ],
  "decisions": [],
  "query_trace": [
    { "query": "q4_evidence_pack", "params": { "pid": "syn-p1", "fid": "syn-p1:fnd-ccb-edema-loop-1" }, "rows": 4, "mode": "fixture", "result_ids": ["syn-p1:ep-amlodipine", "syn-p1:ep-furosemide", "syn-p1:obs-ankle-swelling"] },
    { "query": "q2_next_question", "params": { "pid": "syn-p1" }, "rows": 1, "mode": "fixture", "result_ids": ["syn-p1:req-furosemide-indication"] },
    { "query": "q5_review_history", "params": { "pid": "syn-p1", "fid": "syn-p1:fnd-ccb-edema-loop-1" }, "rows": 1, "mode": "fixture", "result_ids": ["syn-p1:fnd-ccb-edema-loop-1:rev-1"] }
  ]
}
```

## POST /patients/{id}/evidence

Request (story 3's pending date correction):

```json
{
  "event_id": "syn-p3:evt-onset-correction",
  "case_version": 4,
  "change": {
    "fact_id": "syn-p3:obs-ankle-swelling",
    "field": "happened_at",
    "value": 14,
    "state": "documented",
    "source_id": "syn-p3:src-gp-note-d14"
  }
}
```

- `field` is one of `happened_at`, `state`, `indication`, `indication_state`, `stop_day`. Setting `happened_at` or `indication` also sets the matching state field to `change.state`.
- `state: "not_available"` keeps the value empty and marks the requirement `not_available`. It is never read as "no".
- `event_id` must be scoped to the patient. Re-sending an `event_id` that was already accepted returns the stored result with `"replayed": true`, even if `case_version` has moved since.

**200**

```json
{
  "event_id": "syn-p3:evt-onset-correction",
  "patient_id": "syn-p3",
  "case_version_before": 4,
  "case_version": 5,
  "before": { "id": "syn-p3:obs-ankle-swelling", "happened_at": 28, "recorded_at": 45, "state": "reported", "source_ids": ["syn-p3:src-cg-d45"], "…": "…" },
  "after":  { "id": "syn-p3:obs-ankle-swelling", "happened_at": 14, "recorded_at": 62, "state": "documented", "source_ids": ["syn-p3:src-cg-d45", "syn-p3:src-gp-note-d14"], "…": "…" },
  "affected_finding_ids": ["syn-p3:fnd-ccb-edema-loop-1"],
  "new_revisions": [
    {
      "id": "syn-p3:fnd-ccb-edema-loop-1:rev-2", "patient_id": "syn-p3", "finding_id": "syn-p3:fnd-ccb-edema-loop-1",
      "n": 2, "status": "needs_reassessment",
      "reason": "Ankle swelling: happened_at changed from 28 (reported) to 14 (documented). Needs a fresh look.",
      "changed_fact_ids": ["syn-p3:obs-ankle-swelling"], "created_at": 62, "previous_n": 1, "eval_version": 1
    }
  ],
  "pending_reevaluation_ids": [],
  "replayed": false
}
```

`affected_finding_ids` is the Q3 scope. Reviewed findings get revision n+1 with status
`needs_reassessment`, and their decision stays on revision n. Other affected findings are listed in
`pending_reevaluation_ids` for the engine to re-evaluate.

**409**

```json
{ "error": "stale_case_version", "patient_id": "syn-p3", "sent": 3, "current": 4 }
```

## POST /findings/{id}/review

```json
{ "case_version": 2, "revision_n": 1, "by_role": "pharmacist", "decision": "defer", "reason": "Waiting for the furosemide reason." }
```

`decision` is one of `follow_up`, `no_action`, `defer`. `by_role` is `clinician` or `pharmacist`. The
decision attaches to `revision_n`. An accepted review bumps `case_version`.

**200**

```json
{
  "case_version": 3,
  "decision": {
    "id": "syn-p1:fnd-ccb-edema-loop-1:rev-1:dec-1", "patient_id": "syn-p1", "finding_id": "syn-p1:fnd-ccb-edema-loop-1",
    "revision_n": 1, "by_role": "pharmacist", "decision": "defer", "reason": "Waiting for the furosemide reason.", "decided_at": 60
  },
  "finding": { "id": "syn-p1:fnd-ccb-edema-loop-1", "status": "reviewed", "revision_n": 1, "…": "…" }
}
```

**409**: `stale_case_version` or `stale_revision` (see Errors).

## GET /patients/{id}/packet

The review packet for the clinician: one item per finding (except `not_matched`), plus a disclaimer.

```json
{
  "patient": { "id": "syn-p3", "case_version": 4, "…": "…" },
  "case_version": 4,
  "disclaimer": "Synthetic data. These are possible patterns for a clinician to review, not conclusions about what led to what. Any change to a medicine is decided by the prescribing clinician.",
  "items": [
    {
      "finding": { "id": "syn-p3:fnd-ccb-edema-loop-1", "status": "reviewed", "…": "…" },
      "pattern": { "id": "pat-ccb-edema-loop", "…": "…" },
      "documented": ["…"], "conflicts": [], "unknowns": [], "open_questions": [],
      "revisions": [{ "n": 1, "status": "candidate", "…": "…" }],
      "decisions": [{ "revision_n": 1, "by_role": "clinician", "decision": "follow_up", "reason": "Possible pattern noted. …", "decided_at": 50, "…": "…" }]
    }
  ]
}
```

## POST /sandbox/reset

Restores every patient to the fixtures and clears the event log.

```json
{ "reset": true, "patients": [{ "id": "syn-p1", "case_version": 2, "…": "…" }, "…"] }
```
