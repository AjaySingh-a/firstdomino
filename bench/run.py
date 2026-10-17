"""P2 proof suite: run data/cases/case*.json against the graph-mode engine on FalkorDB and write
bench/results.md.

    uv run python -m bench.run            # FalkorDB on localhost:6379 (FALKORDB_HOST/PORT/URL override)

Each case is seeded into its own throwaway graphs (the real loader and rules), its steps go through the
same store the API uses (GraphStore.review / submit_evidence), and every expectation is compared as it
is. A disagreement is reported, never fixed here: the engine is not changed to make a case pass.

The cases were written by the team that built the engine, from docs/data-model.md and the story
fixtures. Agreement means the engine does what its documentation says. It is not clinical accuracy.
"""

from __future__ import annotations

import json
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from api.graph_store import GraphStore
from api.models import EvidenceRequest, ReviewRequest, StoryFixture
from api.store import REPO, FixtureStore, load_patterns
from engine.db import connect, family_graph, run
from engine.loaders.seed import seed

CASES = REPO / "data" / "cases"
RESULTS = REPO / "bench" / "results.md"
NOTE = (
    "These 12 synthetic cases were written by the team that built the engine, and every expected result "
    "was derived from the documented rules (`docs/data-model.md`) and the story fixtures, not from "
    "`engine/rules.py`. Agreement shows that the engine does what its own documentation says. It is not "
    "a measure of clinical accuracy, and none of this is clinical validation."
)


@dataclass
class Check:
    name: str
    expected: Any
    actual: Any

    @property
    def ok(self) -> bool:
        return self.expected == self.actual


@dataclass
class Outcome:
    case: dict[str, Any]
    checks: list[Check] = field(default_factory=list)
    error: str | None = None

    @property
    def agreed(self) -> int:
        return sum(c.ok for c in self.checks)

    @property
    def ok(self) -> bool:
        return self.error is None and all(c.ok for c in self.checks)


def story_of(case: dict[str, Any], p: dict[str, Any]) -> StoryFixture:
    """A case patient as a story fixture: starting facts only. Findings, requirements and revisions are
    left empty; the engine derives them."""
    return StoryFixture.model_validate(
        {
            "synthetic": True,
            "story_id": f"{case['case_id']}-{p['patient']['id']}",
            "title": case["title"],
            "notes": case["notes"],
            **p,
            "findings": [],
            "requirements": [],
            "questions": [],
            "revisions": [],
            "decisions": [],
            "agent_steps": [],
            "pending_evidence": [],
        }
    )


def requirements(g, pid: str, fid: str) -> list[tuple]:
    rows = run(g, "q9_requirements", pid=pid)
    return sorted((r["kind"], r["fact_id"], r["state"]) for r in rows if fid in r["finding_ids"])


def same_requirements(expected: list[dict], actual: list[tuple]) -> tuple[list, list]:
    """Expected requirements with `about: null` match on kind and state only (the doc does not say
    which fact they are about). Returns (expected, actual) in a comparable form."""
    loose = {i for i, e in enumerate(expected) if e["about"] is None}
    exp = sorted((e["kind"], e["about"] if e["about"] else "(any fact)", e["state"]) for e in expected)
    act = list(actual)
    if loose:
        kinds = {(e["kind"], e["state"]) for i, e in enumerate(expected) if i in loose}
        act = [(k, "(any fact)", s) if (k, s) in kinds else (k, f, s) for k, f, s in act]
    return exp, sorted(act)


def scoped(pid: str, f) -> list[str]:
    """Every ID a finding links to must belong to its own patient."""
    ids = [
        f.index_episode_id,
        f.marker_episode_id,
        *f.observation_ids,
        *f.cited_source_ids,
        *f.requirement_ids,
    ]
    return [i for i in ids if not i.startswith(f"{pid}:")]


def run_case(db, case: dict[str, Any], patterns) -> Outcome:
    out = Outcome(case)
    tag = f"bench_{case['case_id']}_{uuid.uuid4().hex[:6]}"
    kb, fam = f"kb_{tag}", family_graph(tag)
    stories = [story_of(case, p) for p in case["patients"]]
    try:
        g = seed(db, tag, stories, patterns, reset=True, kb_name=kb)
        store = GraphStore(
            db, FixtureStore({s.patient.id: s for s in stories}, {p.id: p for p in patterns}), tag, []
        )
        affected: list[str] | None = None
        for step in case["steps"]:
            if step["do"] == "review":
                pid = step["finding_id"].split(":", 1)[0]
                store.review(
                    step["finding_id"],
                    ReviewRequest(
                        case_version=store.timeline(pid).patient.case_version,
                        revision_n=step["revision_n"],
                        by_role=step["by_role"],
                        decision=step["decision"],
                        reason=step["reason"],
                    ),
                )
            else:
                pid = step["patient_id"]
                res = store.submit_evidence(
                    pid,
                    EvidenceRequest.model_validate(
                        {
                            "event_id": step["event_id"],
                            "case_version": store.timeline(pid).patient.case_version,
                            "change": step["change"],
                        }
                    ),
                )
                affected = sorted(res.affected_finding_ids)

        expected = case["expected"]
        if "affected_finding_ids" in expected:
            out.checks.append(
                Check(
                    "findings re-evaluated by the change", sorted(expected["affected_finding_ids"]), affected
                )
            )
        for pid, exp in expected.items():
            if pid == "affected_finding_ids":
                continue
            out.checks.append(
                Check(f"{pid} case_version", exp["case_version"], store.timeline(pid).patient.case_version)
            )
            found = {f.id: f for f in store.findings(pid).findings}
            out.checks.append(
                Check(f"{pid} finding IDs", sorted(f["id"] for f in exp["findings"]), sorted(found))
            )
            for f in found.values():
                out.checks.append(Check(f"{f.id} links only to {pid}", [], scoped(pid, f)))
            for ef in exp["findings"]:
                f = found.get(ef["id"])
                if f is None:
                    continue
                inv = store.investigation(f.id)
                out.checks += [
                    Check(f"{f.id} status", ef["status"], f.status),
                    Check(f"{f.id} revision_n", ef["revision_n"], f.revision_n),
                    Check(
                        f"{f.id} revision statuses",
                        ef["revision_statuses"],
                        [r.status for r in inv.revisions],
                    ),
                    Check(
                        f"{f.id} requirements (kind, about, state)",
                        *same_requirements(ef["requirements"], requirements(g, pid, f.id)),
                    ),
                ]
                if "decisions_on_revisions" in ef:
                    out.checks.append(
                        Check(
                            f"{f.id} decisions on revision",
                            ef["decisions_on_revisions"],
                            [d.revision_n for d in inv.decisions],
                        )
                    )
                if "conflicts" in ef:
                    out.checks.append(
                        Check(
                            f"{f.id} conflicts",
                            sorted(ef["conflicts"]),
                            sorted({c.fact_id for c in inv.conflicts}),
                        )
                    )
                if "next_question" in ef:
                    q = inv.next_question
                    out.checks.append(
                        Check(f"{f.id} next question", ef["next_question"], q.id if q else None)
                    )
    except Exception as exc:  # a crash is a result too: shown as it is
        out.error = f"{type(exc).__name__}: {exc}"
    finally:
        for name in (kb, fam):
            if name in db.list_graphs():
                db.select_graph(name).delete()
    return out


def show(v: Any) -> str:
    return f"`{json.dumps(v)}`"


def report(outcomes: list[Outcome], falkordb: str) -> str:
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], cwd=REPO, capture_output=True, text=True
    ).stdout.strip()
    agreed = sum(o.ok for o in outcomes)
    lines = [
        "# P2 proof suite: results",
        "",
        f"> {NOTE}",
        "",
        f"Run {datetime.now(UTC):%Y-%m-%d %H:%M} UTC on commit `{commit or 'unknown'}`, graph-mode engine, "
        f"FalkorDB {falkordb} (local). Command: `uv run python -m bench.run`.",
        "",
        f"**{agreed} of {len(outcomes)} cases agree with their documented expectation** "
        f"({sum(o.agreed for o in outcomes)} of {sum(len(o.checks) for o in outcomes)} checks).",
        "",
        "| Case | Covers | Checks agreed | Result |",
        "|---|---|---|---|",
    ]
    for o in outcomes:
        result = "agrees" if o.ok else ("**error**" if o.error else "**disagrees**")
        lines.append(
            f"| `{o.case['case_id']}` | {o.case['covers']} | {o.agreed}/{len(o.checks)} | {result} |"
        )
    failing = [o for o in outcomes if not o.ok]
    lines += ["", "## Disagreements, as they are", ""]
    if not failing:
        lines += ["None.", ""]
    for o in failing:
        lines += [
            f"### `{o.case['case_id']}`: {o.case['covers']}",
            "",
            f"Why this was expected: {o.case['reasoning']}",
            "",
        ]
        if o.error:
            lines += [f"The case raised: `{o.error}`", ""]
        if any(not c.ok for c in o.checks):
            lines += ["| Check | Expected | Engine |", "|---|---|---|"]
            lines += [f"| {c.name} | {show(c.expected)} | {show(c.actual)} |" for c in o.checks if not c.ok]
            lines.append("")
    lines += [
        "## What each case checks",
        "",
        "Every case checks each patient's `case_version`, the finding IDs, that each finding links only "
        "to its own patient's facts, sources and requirements, and per finding: status, revision count, "
        "the status of every revision, and requirements as (kind, fact it is about, state). Some cases "
        "also check the review decision's revision, the listed conflicts, the next question, or which "
        "findings a change re-evaluated. Case files: `data/cases/case01.json` ... `case12.json`, each "
        "with its reasoning and the doc sections it comes from.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    db = connect()
    try:
        db.connection.ping()
    except Exception as exc:
        print(
            f"FalkorDB is not reachable ({type(exc).__name__}). Start it: "
            "docker run -d --name fd-test -p 6379:6379 falkordb/falkordb:latest",
            file=sys.stderr,
        )
        return 2
    modules = db.connection.execute_command("MODULE", "LIST")
    ver = next((m[3] for m in modules if m[1] in (b"graph", "graph")), None)
    falkordb = f"{ver // 10000}.{ver // 100 % 100}.{ver % 100}" if isinstance(ver, int) else "unknown version"
    patterns = list(load_patterns().values())
    cases = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(CASES.glob("case*.json"))]
    outcomes = [run_case(db, c, patterns) for c in cases]
    for o in outcomes:
        print(
            f"{o.case['case_id']}  {o.agreed}/{len(o.checks)}  {'agrees' if o.ok else 'DISAGREES'}"
            + (f"  {o.error}" if o.error else "")
        )
    RESULTS.write_text(report(outcomes, falkordb), encoding="utf-8")
    print(f"wrote {RESULTS.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
