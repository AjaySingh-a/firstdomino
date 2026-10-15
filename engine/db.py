"""FalkorDB connection and graph names. Every query text comes from engine.cypher.load()."""

from __future__ import annotations

import os
from typing import Any

from falkordb import FalkorDB, Graph

from engine import cypher

KB_GRAPH = "kb_template"
FAMILY_PREFIX = "family_"


def family_graph(family_id: str) -> str:
    return f"{FAMILY_PREFIX}{family_id}"


def connect() -> FalkorDB:
    return FalkorDB(
        host=os.environ.get("FALKORDB_HOST", "localhost"),
        port=int(os.environ.get("FALKORDB_PORT", "6379")),
        password=os.environ.get("FALKORDB_PASSWORD") or None,
    )


def run(graph: Graph, query: str, /, **params: Any) -> list[dict[str, Any]]:
    """Run the named query with parameters; rows come back as dicts keyed by column name."""
    res = graph.query(cypher.load(query), params)
    cols = [h[1] if isinstance(h, (list, tuple)) else h for h in res.header]
    return [dict(zip(cols, row, strict=True)) for row in res.result_set]


def props(node: Any) -> dict[str, Any]:
    """Node properties. FalkorDB never stores null, so a missing key reads as None (not known)."""
    return dict(node.properties) if node is not None else {}
