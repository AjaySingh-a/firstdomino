"""Contract guards: fixtures, snapshots, TS/pydantic parity, Cypher conventions, copy rules."""

import re
from pathlib import Path

from pydantic import BaseModel

import api.models as models
from api import snapshots
from api.store import REPO, load_patterns, load_stories
from engine import cypher

TS_TYPES = REPO / "web" / "lib" / "types.ts"


def test_fixtures_validate_and_are_patient_scoped():
    stories = load_stories()  # StoryFixture validates the scoping
    assert set(stories) == {"syn-p1", "syn-p2", "syn-p3"}
    patterns = load_patterns()
    for s in stories.values():
        assert s.synthetic and s.patient.synthetic
        assert any("SYNTHETIC" in n for n in s.notes)
        for f in s.findings:
            assert f.pattern_id in patterns


def test_snapshot_is_up_to_date():
    current = snapshots.SNAPSHOT.read_text(encoding="utf-8")
    assert current == snapshots.render(), "run: uv run python -m api.snapshots"


def _ts_interfaces() -> dict[str, set[str]]:
    src = TS_TYPES.read_text(encoding="utf-8")
    raw = {}
    pattern = r"export interface (\w+)(?:\s+extends\s+([\w,\s]+?))?\s*\{(.*?)\n\}"
    for name, parents, body in re.findall(pattern, src, re.S):
        fields = set(re.findall(r"^\s*(\w+)\??\s*:", body, re.M))
        raw[name] = (fields, [p.strip() for p in parents.split(",") if p.strip()])

    def resolve(name: str) -> set[str]:
        fields, parents = raw[name]
        out = set(fields)
        for p in parents:
            out |= resolve(p)
        return out

    return {name: resolve(name) for name in raw}


def test_typescript_mirrors_pydantic():
    ts = _ts_interfaces()
    for name, cls in vars(models).items():
        if not (isinstance(cls, type) and issubclass(cls, BaseModel)) or name == "Model":
            continue
        if cls.__module__ != models.__name__:
            continue
        assert name in ts, f"web/lib/types.ts is missing interface {name}"
        assert ts[name] == set(cls.model_fields), f"{name}: fields differ"


def test_every_query_is_named_and_starts_from_patient():
    assert cypher.names() == [
        "q10_agent_steps", "q11_finding_path", "q12_medicine_link", "q1_candidate_match", "q2_next_question",
        "q3_affected", "q4_evidence_pack", "q5_history", "q6_patient_findings", "q7_timeline",
        "q8_evidence_event", "q9_requirements",
    ]
    for name in cypher.names():
        body = "\n".join(
            line for line in cypher.load(name).splitlines() if not line.strip().startswith("//")
        )
        assert "$pid" in body, name
        for part in re.split(r"\bUNION\b", body):
            first_node = re.search(r"MATCH\s*\(([^)]*)\)", part).group(1)
            assert first_node.replace(" ", "") == "p:Patient{id:$pid}", name


BANNED = re.compile(r"\bsafe\b|stop taking|\bcleared\b|caused by", re.I)
COPY_ROOTS = [
    "data/stories", "data/patterns", "data/snapshots", "data/cases", "bench", "api", "agent", "engine",
    "mcp_server", "web/app", "web/lib", "web/components",
]


def test_copy_rules():
    hits = []
    for root in COPY_ROOTS:
        for path in Path(REPO, root).rglob("*"):
            if path.suffix not in {".json", ".py", ".ts", ".tsx"} or "fixtures" in path.parts:
                continue
            for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if BANNED.search(line):
                    hits.append(f"{path.relative_to(REPO)}:{i}: {line.strip()}")
    assert not hits, "\n".join(hits)
