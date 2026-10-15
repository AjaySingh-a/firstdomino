"""Deterministic finding rules applied to Q1 rows. Owner: Dev.

Rules (data-model.md, "Finding statuses"), in precedence order:
- Two documented facts in the reverse order of the pattern -> not_matched.
  If either side is only reported, the order is not settled: an `order` requirement instead.
- The second medicine has a documented, different indication -> competing_explanation
  (shown, never dismissed).
- Any required fact unknown -> needs_evidence, one EvidenceRequirement per gap.
- Conflicting facts -> stays candidate, with the conflict listed.

Unknown is never absent: a null day or an `unknown` state always becomes a requirement,
never a "no". `window_days` is shown with the pattern but does not exclude anything.

Only this module creates findings. The LLM never creates findings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from api.models import EvidenceRequirement, FindingStatus

EVAL_VERSION = 1

KNOWN = ("documented", "reported")

# Indications that name the pattern's own effect. Exact phrases only: anything else that is
# documented counts as a different indication and is shown as a competing explanation.
EFFECT_TERMS = {
    "peripheral_edema": {
        "ankle swelling", "leg swelling", "swelling", "swollen ankles", "swollen legs",
        "edema", "oedema", "peripheral edema", "peripheral oedema", "ankle edema", "leg edema",
    },
}


@dataclass(frozen=True)
class Point:
    """One dated fact on the pattern's chain: index start, effect onset, marker start."""

    fact_id: str
    label: str
    day: int | None
    state: str

    @property
    def known(self) -> bool:
        return self.day is not None and self.state in KNOWN


@dataclass
class Evaluation:
    finding_id: str
    patient_id: str
    pattern_id: str
    pattern_version: int
    index_ep: str
    marker_ep: str
    effect: str
    status: FindingStatus
    observation_ids: list[str]
    requirements: list[EvidenceRequirement]
    conflicts: list[str] = field(default_factory=list)  # fact ids
    headline: str = ""
    reason: str = ""
    eval_version: int = EVAL_VERSION


def local(fact_id: str) -> str:
    """'syn-p1:ep-furosemide' -> 'furosemide'; 'syn-p1:obs-ankle-swelling' -> 'ankle-swelling'."""
    tail = fact_id.split(":", 1)[1]
    for prefix in ("ep-", "obs-"):
        if tail.startswith(prefix):
            return tail[len(prefix):]
    return tail


def observations(row: dict[str, Any]) -> list[Point]:
    """Q1's collect() over an empty OPTIONAL MATCH yields [[None, ...]]: drop those entries."""
    out = [Point(o[0], o[3] or "", o[1], o[2] or "unknown") for o in row["observations"] if o[0]]
    return sorted(out, key=lambda p: p.fact_id)


def evaluate(row: dict[str, Any], patient_id: str, finding_id: str) -> Evaluation:
    requires = set(row.get("requires") or ["start_day", "onset_day", "indication", "order"])
    a = Point(row["index_ep"], row["a_name"], row["a_start"], row["a_state"] or "unknown")
    b = Point(row["marker_ep"], row["b_name"], row["b_start"], row["b_state"] or "unknown")
    obs = observations(row)
    reqs: list[EvidenceRequirement] = []
    conflicts: list[str] = []
    gaps: list[str] = []

    def need(kind: str, fact_id: str, fld: str, text: str, state: str = "missing") -> None:
        if kind not in requires:
            return
        rid = f"{patient_id}:req-{local(fact_id)}-{kind}" + ("" if fld != "via_effect" else "-effect")
        if any(r.id == rid for r in reqs):
            return
        reqs.append(EvidenceRequirement(
            id=rid, patient_id=patient_id, finding_id=finding_id, kind=kind,
            about_fact_id=fact_id, field=fld, state=state,
        ))
        gaps.append(text)

    # --- start days ---
    for ep in (a, b):
        if ep.state == "conflicting":
            conflicts.append(ep.fact_id)
        elif not ep.known:
            need("start_day", ep.fact_id, "happened_at", f"the day {ep.label} was started")

    # --- effect onset (earliest known observation) ---
    for o in obs:
        if o.state == "conflicting":
            conflicts.append(o.fact_id)
    known_obs = [o for o in obs if o.known]
    onset = min(known_obs, key=lambda o: o.day) if known_obs else None
    if onset is None:
        unknown_obs = [o for o in obs if o.state != "conflicting"]
        for o in unknown_obs:
            need("onset_day", o.fact_id, "happened_at", f"when the {o.label.lower()} began")
        if not obs:
            # No observation recorded is "not known yet", not "no swelling".
            need("onset_day", a.fact_id, "via_effect",
                 f"whether {row['effect'].replace('_', ' ')} was noticed after {a.label} was started")

    # --- order: index start < onset < marker start ---
    chain = [p for p in (a, onset, b) if p is not None and p.known]
    reversed_documented: list[tuple[Point, Point]] = []
    for i, first in enumerate(chain):
        for second in chain[i + 1:]:
            if first.day < second.day:
                continue
            if first.day > second.day and first.state == second.state == "documented":
                reversed_documented.append((first, second))
            else:
                unsure = second if second.state != "documented" else first
                need("order", unsure.fact_id, "happened_at",
                     f"whether {_name(first)} came before {_name(second)}")

    # --- indication of the second medicine ---
    ind, ind_state = row.get("b_indication"), row.get("b_ind_state") or "unknown"
    competing = False
    if ind_state == "conflicting":
        conflicts.append(b.fact_id)
    elif ind_state == "not_available":
        need("indication", b.fact_id, "indication", f"the reason {b.label} was started",
             state="not_available")
    elif ind_state not in KNOWN or not ind:
        need("indication", b.fact_id, "indication", f"the reason {b.label} was started")
    elif ind_state == "documented" and not _names_effect(ind, row["effect"]):
        competing = True

    # --- status ---
    status: FindingStatus
    if reversed_documented:
        status, reqs, gaps = "not_matched", [], []
    elif competing:
        status = "competing_explanation"
    elif reqs:
        status = "needs_evidence"
    else:
        status = "candidate"

    ev = Evaluation(
        finding_id=finding_id, patient_id=patient_id, pattern_id=row["pattern"],
        pattern_version=row["pattern_version"], index_ep=a.fact_id, marker_ep=b.fact_id,
        effect=row["effect"], status=status, observation_ids=[o.fact_id for o in obs],
        requirements=reqs, conflicts=sorted(set(conflicts)),
    )
    ev.headline = _headline(status, a, obs, b)
    ev.reason = _reason(status, b, ind, gaps, reversed_documented, ev.conflicts)
    return ev


def evaluate_rows(rows: list[dict[str, Any]], patient_id: str) -> list[Evaluation]:
    """Finding IDs are stable: <pid>:fnd-<pattern without 'pat-'>-<k>, k over Q1's ORDER BY."""
    out, per_pattern = [], {}
    for row in rows:
        k = per_pattern[row["pattern"]] = per_pattern.get(row["pattern"], 0) + 1
        fid = f"{patient_id}:fnd-{row['pattern'].removeprefix('pat-')}-{k}"
        out.append(evaluate(row, patient_id, fid))
    return out


# ---------- text (no causal wording: see tests/test_rules.py) ----------


def _name(p: Point) -> str:
    return f"the {p.label.lower()}" if p.fact_id.split(":", 1)[1].startswith("obs-") else p.label


def _names_effect(indication: str, effect: str) -> bool:
    return indication.strip().lower() in EFFECT_TERMS.get(effect, {effect.replace("_", " ")})


def _headline(status: str, a: Point, obs: list[Point], b: Point) -> str:
    steps = [a.label, *([obs[0].label.lower()] if obs else []), b.label]
    if status == "not_matched":
        return "Order does not fit the pattern: " + ", ".join(steps)
    return "Possible pattern: " + ", then ".join(steps)


def _reason(status, b, ind, gaps, reversed_documented, conflicts) -> str:
    parts = ["First evaluation."]
    if status == "not_matched":
        first, second = reversed_documented[0]
        parts.append(
            f"Documented days put {_name(second)} (day {second.day}) before {_name(first)} "
            f"(day {first.day}), so the order does not fit this pattern."
        )
    if status == "competing_explanation":
        parts.append(
            f"The reason {b.label} was started is documented as \"{ind}\". "
            "This is another explanation worth reviewing alongside the pattern."
        )
    if gaps:
        parts.append("Not known yet: " + "; ".join(gaps) + ".")
    if conflicts:
        parts.append("Records conflict for: " + ", ".join(conflicts) + ". Both versions are shown.")
    if status == "candidate" and not conflicts:
        parts.append("The documented and reported days fit the order of this pattern.")
    return " ".join(parts)
