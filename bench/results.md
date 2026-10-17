# P2 proof suite: results

> These 12 synthetic cases were written by the team that built the engine, and every expected result was derived from the documented rules (`docs/data-model.md`) and the story fixtures, not from `engine/rules.py`. Agreement shows that the engine does what its own documentation says. It is not a measure of clinical accuracy, and none of this is clinical validation.

Run 2026-10-17 20:16 UTC on commit `ecf7250`, graph-mode engine, FalkorDB 4.22.1 (local). Command: `uv run python -m bench.run`.

**12 of 12 cases agree with their documented expectation** (98 of 98 checks).

| Case | Covers | Checks agreed | Result |
|---|---|---|---|
| `case01` | positive match (candidate) | 7/7 | agrees |
| `case02` | unknown onset (needs_evidence) | 7/7 | agrees |
| `case03` | unknown indication (needs_evidence) | 7/7 | agrees |
| `case04` | documented different reason (competing_explanation) | 7/7 | agrees |
| `case05` | reported different reason (competing_explanation) | 7/7 | agrees |
| `case06` | reversed documented chronology (not_matched) | 7/7 | agrees |
| `case07` | reported reversed order (order requirement) | 7/7 | agrees |
| `case08` | conflicting dates (stays candidate, conflict listed) | 8/8 | agrees |
| `case09` | reviewed then corrected (needs_reassessment, decision kept) | 9/9 | agrees |
| `case10` | unrelated medicine change (no revision) | 8/8 | agrees |
| `case11` | not_available answer (never read as 'no') | 9/9 | agrees |
| `case12` | two patients in one family graph (no crossing) | 15/15 | agrees |

## Disagreements, as they are

None.

## What each case checks

Every case checks each patient's `case_version`, the finding IDs, that each finding links only to its own patient's facts, sources and requirements, and per finding: status, revision count, the status of every revision, and requirements as (kind, fact it is about, state). Some cases also check the review decision's revision, the listed conflicts, the next question, or which findings a change re-evaluated. Case files: `data/cases/case01.json` ... `case12.json`, each with its reasoning and the doc sections it comes from.
