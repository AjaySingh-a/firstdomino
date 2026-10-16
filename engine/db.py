"""FalkorDB connection and graph names. Every query text comes from engine.cypher.load()."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import unquote, urlsplit

from falkordb import FalkorDB, Graph

from engine import cypher

KB_GRAPH = "kb_template"
FAMILY_PREFIX = "family_"


def family_graph(family_id: str) -> str:
    return f"{FAMILY_PREFIX}{family_id}"


def connection_settings() -> dict[str, Any]:
    """Where FalkorDB is. FALKORDB_URL (redis://[user:pass@]host:port, or rediss:// for TLS; Railway's
    FALKORDB_PRIVATE_URL) wins over FALKORDB_HOST / FALKORDB_PORT / FALKORDB_PASSWORD.
    The result holds the password: never log it or put it in an error message."""
    url = os.environ.get("FALKORDB_URL", "").strip()
    if not url:
        return {
            "host": os.environ.get("FALKORDB_HOST", "localhost"),
            "port": int(os.environ.get("FALKORDB_PORT", "6379")),
            "username": None,
            "password": os.environ.get("FALKORDB_PASSWORD") or None,
            "ssl": False,
        }
    u = urlsplit(url if "://" in url else f"redis://{url}")
    if u.scheme not in ("redis", "rediss", "falkor", "falkors") or not u.hostname:
        raise ValueError("FALKORDB_URL must look like redis://[user:password@]host:port")  # no value echoed
    return {
        "host": u.hostname,
        "port": u.port or 6379,
        "username": unquote(u.username) if u.username and u.username != "default" else None,
        "password": unquote(u.password) if u.password else None,
        "ssl": u.scheme in ("rediss", "falkors"),
    }


def connect() -> FalkorDB:
    s = connection_settings()
    return FalkorDB(
        host=s["host"], port=s["port"], username=s["username"], password=s["password"], ssl=s["ssl"],
        # Fail fast when FalkorDB is unreachable, so the API answers 503 instead of hanging.
        socket_connect_timeout=float(os.environ.get("FD_DB_CONNECT_TIMEOUT", "5")),
        socket_timeout=float(os.environ.get("FD_DB_TIMEOUT", "30")),
    )


def run(graph: Graph, query: str, /, **params: Any) -> list[dict[str, Any]]:
    """Run the named query with parameters; rows come back as dicts keyed by column name."""
    res = graph.query(cypher.load(query), params)
    cols = [h[1] if isinstance(h, (list, tuple)) else h for h in res.header]
    return [dict(zip(cols, row, strict=True)) for row in res.result_set]


def props(node: Any) -> dict[str, Any]:
    """Node properties. FalkorDB never stores null, so a missing key reads as None (not known)."""
    return dict(node.properties) if node is not None else {}
