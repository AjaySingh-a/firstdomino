"""Deterministic finding rules applied to Q1 rows. Owner: Dev. Not implemented yet.

Planned rules (section 6 of the plan):
- Both starts documented and the order reversed -> not_matched.
- The second medicine has a documented, different indication -> competing_explanation
  (shown, never dismissed).
- Any required fact unknown -> needs_evidence, one EvidenceRequirement per gap.
- Conflicting dates -> stays candidate, with the conflict shown.

Only this module creates findings. The LLM never creates findings.
"""

from __future__ import annotations

from typing import Any

from api.models import EvidenceRequirement, FindingStatus


def evaluate(q1_row: dict[str, Any]) -> tuple[FindingStatus, list[EvidenceRequirement]]:
    raise NotImplementedError("engine rules land after the contracts (Dev)")
