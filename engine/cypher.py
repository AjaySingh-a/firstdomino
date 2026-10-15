"""Load named Cypher queries from engine/queries/*.cypher. Never inline Cypher elsewhere."""

from __future__ import annotations

from functools import cache
from pathlib import Path

QUERY_DIR = Path(__file__).resolve().parent / "queries"


@cache
def load(name: str) -> str:
    """load("q1_candidate_match") -> query text. Pass values as parameters, never by formatting."""
    return (QUERY_DIR / f"{name}.cypher").read_text(encoding="utf-8")


def names() -> list[str]:
    return sorted(p.stem for p in QUERY_DIR.glob("*.cypher"))
