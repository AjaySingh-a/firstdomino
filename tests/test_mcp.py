"""MCP server: tools, write gating, synthetic-only writes and error wording, over a fake HTTP layer.

The fake is the API itself on the fixture store (TestClient is an httpx.Client), so responses follow the
real contract; httpx.MockTransport covers the failures. No network.
"""

import asyncio
import os
import re
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.server.fastmcp.exceptions import ToolError

from api.main import app, store
from mcp_server.client import DEFAULT_API_URL, FirstDominoAPI
from mcp_server.server import build_server

REPO = Path(__file__).resolve().parents[1]
P1_FINDING = "syn-p1:fnd-ccb-edema-loop-1"
READ_TOOLS = {
    "list_stories",
    "get_evidence_pack",
    "next_missing_fact",
    "inspect_episode",
    "which_findings_depend_on",
    "prepare_packet",
}
WRITE_TOOLS = {"ask_question", "run_review_agent"}
BANNED = re.compile(r"\bsafe\b|stop taking|\bcleared\b|caused by", re.I)


@pytest.fixture
def api():
    store.reset()
    with TestClient(app) as c:
        yield FirstDominoAPI("http://testserver", client=c)


def tool_names(server) -> set[str]:
    return {t.name for t in asyncio.run(server.list_tools())}


def call(server, name: str, **args) -> str:
    content, _ = asyncio.run(server.call_tool(name, args))
    text = content[0].text
    assert not BANNED.search(text), text
    assert "Evidence IDs:" in text.splitlines()[-1]
    return text


def evidence_ids(text: str) -> set[str]:
    return set(text.splitlines()[-1].removeprefix("Evidence IDs: ").split(", "))


def test_read_only_by_default(api, monkeypatch):
    monkeypatch.delenv("FD_MCP_ALLOW_WRITES", raising=False)
    assert tool_names(build_server(api)) == READ_TOOLS


def test_writes_only_with_the_flag(api, monkeypatch):
    monkeypatch.setenv("FD_MCP_ALLOW_WRITES", "1")
    assert tool_names(build_server(api)) == READ_TOOLS | WRITE_TOOLS
    monkeypatch.setenv("FD_MCP_ALLOW_WRITES", "true")
    assert tool_names(build_server(api)) == READ_TOOLS


def test_default_base_url(monkeypatch):
    monkeypatch.delenv("FD_API_URL", raising=False)
    assert FirstDominoAPI().base_url == DEFAULT_API_URL
    monkeypatch.setenv("FD_API_URL", "http://localhost:8000/")
    assert FirstDominoAPI().base_url == "http://localhost:8000"


def test_list_stories(api):
    text = call(build_server(api), "list_stories")
    assert {"syn-p1", "syn-p2", "syn-p3", P1_FINDING} <= evidence_ids(text)
    assert "Needs evidence" in text


def test_get_evidence_pack(api):
    text = call(build_server(api), "get_evidence_pack", finding_id=P1_FINDING)
    assert "Not known yet:" in text and "Reason furosemide was started" in text
    assert "Citation: Savage RD" in text
    assert {
        P1_FINDING,
        "syn-p1:req-furosemide-indication",
        "syn-p1:src-pharm-d35",
        "syn-p1:q-furosemide-indication",
    } <= evidence_ids(text)


def test_next_missing_fact_points_at_the_dependency_tool(api):
    text = call(build_server(api), "next_missing_fact", patient_id="syn-p1")
    assert "Ask the caregiver" in text
    assert 'which_findings_depend_on("syn-p1", "syn-p1:ep-furosemide")' in text
    assert {
        "syn-p1:ep-furosemide",
        "syn-p1:q-furosemide-indication",
        "syn-p1:req-furosemide-indication",
    } <= evidence_ids(text)


def test_next_missing_fact_when_nothing_is_open(api):
    # Story 2 has another reason on record, so no question is waiting.
    text = call(build_server(api), "next_missing_fact", patient_id="syn-p2")
    assert "No open finding is waiting on a missing fact" in text


def test_inspect_episode(api):
    text = call(build_server(api), "inspect_episode", episode_id="syn-p1:ep-furosemide")
    assert "furosemide" in text and "day 35" in text
    assert "second medicine in:" in text
    assert {"syn-p1:ep-furosemide", P1_FINDING} <= evidence_ids(text)


def test_inspect_episode_unknown(api):
    with pytest.raises(ToolError, match="Episodes for syn-p1: .*syn-p1:ep-amlodipine"):
        call(build_server(api), "inspect_episode", episode_id="syn-p1:ep-nope")


def test_which_findings_depend_on(api):
    text = call(
        build_server(api), "which_findings_depend_on", patient_id="syn-p1", fact_id="syn-p1:ep-furosemide"
    )
    assert evidence_ids(text) == {"syn-p1:ep-furosemide", P1_FINDING}


def test_prepare_packet(api):
    text = call(build_server(api), "prepare_packet", patient_id="syn-p3")
    assert "decided by the prescribing clinician" in text
    assert "Review by the clinician" in text


def test_not_found_is_worded(api):
    with pytest.raises(ToolError, match="Not found: patient syn-p9. list_stories"):
        call(build_server(api), "get_evidence_pack", finding_id="syn-p9:fnd-x")


def test_ask_question_records_on_a_synthetic_story(api):
    text = call(
        build_server(api, allow_writes=True),
        "ask_question",
        requirement_id="syn-p1:req-furosemide-indication",
    )
    assert "Question recorded as asked" in text and "Case version is now 3" in text
    again = call(
        build_server(api, allow_writes=True),
        "ask_question",
        requirement_id="syn-p1:req-furosemide-indication",
    )
    assert "already on record" in again


def test_run_review_agent(api):
    text = call(build_server(api, allow_writes=True), "run_review_agent", finding_id=P1_FINDING)
    assert "draft_packet_text: ok" in text and "never creates or changes findings" in text


def fake(handler) -> FirstDominoAPI:
    return FirstDominoAPI(
        "http://fake", client=httpx.Client(base_url="http://fake", transport=httpx.MockTransport(handler))
    )


def test_writes_refuse_a_patient_that_is_not_synthetic():
    posts = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            posts.append(req.url.path)
            return httpx.Response(500)
        return httpx.Response(
            200,
            json=[
                {
                    "id": "real-1",
                    "label": "x",
                    "age_band": "70-74",
                    "case_version": 1,
                    "as_of_day": 0,
                    "synthetic": False,
                },
            ],
        )

    server = build_server(fake(handler), allow_writes=True)
    for name, arg in (
        ("ask_question", {"requirement_id": "real-1:req-x"}),
        ("run_review_agent", {"finding_id": "real-1:fnd-x"}),
        ("ask_question", {"requirement_id": "syn-p9:req-x"}),
    ):
        with pytest.raises(ToolError, match="limited to the synthetic stories"):
            asyncio.run(server.call_tool(name, arg))
    assert posts == []


def test_graph_unavailable_is_worded():
    server = build_server(fake(lambda r: httpx.Response(503, json={"error": "evaluation_unavailable"})))
    with pytest.raises(ToolError, match="cannot reach its graph"):
        asyncio.run(server.call_tool("list_stories", {}))


def test_api_unreachable_is_worded():
    def handler(req):
        raise httpx.ConnectError("refused")

    with pytest.raises(ToolError, match="Could not reach the FirstDomino API at http://fake"):
        asyncio.run(build_server(fake(handler)).call_tool("list_stories", {}))


def test_mcp_package_is_not_shadowed():
    out = subprocess.run(
        [sys.executable, "-c", "import mcp; print(mcp.__file__)"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    assert "site-packages" in out.stdout
    assert not (REPO / "mcp").exists()


def test_stdio_handshake_lists_the_read_tools():
    """The real entry point over stdio: initialize, then tools/list. Listing makes no API call."""

    async def go():
        env = {k: v for k, v in os.environ.items() if k != "FD_MCP_ALLOW_WRITES"}
        params = StdioServerParameters(
            command=sys.executable, args=["-m", "mcp_server"], cwd=str(REPO), env=env
        )
        async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
            init = await session.initialize()
            return init.serverInfo.name, {t.name for t in (await session.list_tools()).tools}

    name, names = asyncio.run(go())
    assert name == "firstdomino"
    assert names == READ_TOOLS
