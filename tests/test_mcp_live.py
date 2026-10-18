"""Smoke test: every read tool of the MCP server against the live FirstDomino API.

Network, so opt-in: FD_MCP_LIVE=1 uv run pytest tests/test_mcp_live.py (FD_API_URL overrides the
default Railway URL). Read tools only; nothing is written.
"""

import asyncio
import os

import pytest

from mcp_server.client import FirstDominoAPI
from mcp_server.server import build_server

pytestmark = pytest.mark.skipif(
    os.environ.get("FD_MCP_LIVE") != "1", reason="set FD_MCP_LIVE=1 (calls the live API)"
)

CALLS = [
    ("list_stories", {}),
    ("get_evidence_pack", {"finding_id": "syn-p1:fnd-ccb-edema-loop-1"}),
    ("explain_path", {"finding_id": "syn-p1:fnd-ccb-edema-loop-1"}),
    ("next_missing_fact", {"patient_id": "syn-p1"}),
    ("inspect_episode", {"episode_id": "syn-p1:ep-furosemide"}),
    ("which_findings_depend_on", {"patient_id": "syn-p1", "fact_id": "syn-p1:ep-furosemide"}),
    ("prepare_packet", {"patient_id": "syn-p1"}),
]


@pytest.mark.parametrize(("name", "args"), CALLS, ids=[c[0] for c in CALLS])
def test_read_tool_against_live_api(name, args):
    server = build_server(FirstDominoAPI(), allow_writes=False)
    content, _ = asyncio.run(server.call_tool(name, args))
    text = content[0].text
    assert "syn-p1" in text
    assert text.splitlines()[-1].startswith("Evidence IDs: syn-")
