"""Run Q1 for one patient, apply engine/rules.py, and write Finding + EvidenceRequirement +
FindingRevision n=1 into the family graph. Writes are MERGE / ON CREATE, so re-running is a no-op.

`reevaluate` re-runs the rules for the findings Q3 says an evidence change touched, and only those.
"""

from __future__ import annotations

from falkordb import Graph

from engine import rules
from engine.db import run


def evaluate_patient(graph: Graph, pid: str, as_of_day: int) -> list[rules.Evaluation]:
    rows = run(graph, "q1_candidate_match", pid=pid)
    evaluations = rules.evaluate_rows(rows, pid)
    for ev in evaluations:
        run(
            graph, "write/finding", pid=pid, fid=ev.finding_id, index_ep=ev.index_ep,
            marker_ep=ev.marker_ep, pattern_id=ev.pattern_id, status=ev.status,
            pattern_version=ev.pattern_version, eval_version=ev.eval_version, headline=ev.headline,
        )
        run(graph, "write/finding_cites", pid=pid, fid=ev.finding_id, observation_ids=ev.observation_ids)
        for r in ev.requirements:
            run(
                graph, "write/requirement", pid=pid, fid=ev.finding_id, rid=r.id, kind=r.kind,
                field=r.field, state=r.state, about=r.about_fact_id,
            )
        run(
            graph, "write/revision", pid=pid, fid=ev.finding_id, rev_id=f"{ev.finding_id}:rev-1",
            status=ev.status, reason=ev.reason, created_at=as_of_day, eval_version=ev.eval_version,
        )
    return evaluations


def reevaluate(
    graph: Graph, pid: str, targets: dict[str, tuple[str, str]], lead: dict[str, str]
) -> dict[str, rules.Evaluation]:
    """Re-run the rules for `targets` ({finding id: (index episode, marker episode)}) and bring their
    requirements in line. The caller writes the revisions. A finding whose Q1 row no longer exists is
    skipped (pairs come from medicine classes, which evidence changes cannot edit)."""
    rows = {(r["index_ep"], r["marker_ep"]): r for r in run(graph, "q1_candidate_match", pid=pid)}
    out = {}
    for fid, pair in sorted(targets.items()):
        if pair not in rows:
            continue
        ev = out[fid] = rules.evaluate(rows[pair], pid, fid, lead=lead[fid])
        for r in ev.requirements:
            run(
                graph, "write/requirement_sync", pid=pid, fid=fid, rid=r.id, kind=r.kind,
                field=r.field, state=r.state, about=r.about_fact_id,
            )
        if ev.status != "not_matched":  # not_matched drops its gaps; it does not mean they were met
            run(graph, "write/requirement_provided", pid=pid, fid=fid, keep=[r.id for r in ev.requirements])
    return out
