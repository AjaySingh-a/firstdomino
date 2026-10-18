"""The FirstDomino MCP server (stdio). Run it with `uv run python -m mcp_server`.

Read-only tools are always on. The two write tools are registered only when FD_MCP_ALLOW_WRITES=1, and
then act on the synthetic stories only. Every tool goes through the HTTP API (FD_API_URL).
"""

from __future__ import annotations

import os
from collections.abc import Callable

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations

from . import tools
from .client import ApiError, FirstDominoAPI

INSTRUCTIONS = """FirstDomino reconstructs a synthetic patient's medication story and finds possible
prescribing cascades: a side effect of one medicine treated with another medicine. Findings are possible
patterns for a clinician to review, never conclusions, and medicine changes are the prescribing
clinician's decision. Start with list_stories. Each result ends with the evidence IDs it rests on; cite
them. Say "possible pattern", "documented", "reported by the caregiver" and "not known yet"."""

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=True)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=True)


def writes_allowed() -> bool:
    return os.environ.get("FD_MCP_ALLOW_WRITES") == "1"


def build_server(api: FirstDominoAPI | None = None, allow_writes: bool | None = None) -> FastMCP:
    api = api or FirstDominoAPI()
    mcp = FastMCP("firstdomino", instructions=INSTRUCTIONS)

    def run(fn: Callable[..., str], *args: str) -> str:
        try:
            return fn(api, *args)
        except ApiError as exc:
            raise ToolError(str(exc)) from exc

    @mcp.tool(annotations=READ)
    def list_stories() -> str:
        """List the synthetic stories (patients) with their findings, statuses and IDs. Start here."""
        return run(tools.list_stories)

    @mcp.tool(annotations=READ)
    def get_evidence_pack(finding_id: str) -> str:
        """The evidence behind one finding: what is on record, what conflicts, what is not known yet, the
        cited pattern, the sources, and the next question.
        finding_id looks like "syn-p1:fnd-ccb-edema-loop-1"."""
        return run(tools.get_evidence_pack, finding_id)

    @mcp.tool(annotations=READ)
    def explain_path(finding_id: str) -> str:
        """The walk behind one finding, as the path FalkorDB returned: first medicine, its ingredient and
        class, the cited pattern, the second medicine's class, ingredient and episode, plus the symptom.
        finding_id looks like "syn-p1:fnd-ccb-edema-loop-1"."""
        return run(tools.explain_path, finding_id)

    @mcp.tool(annotations=READ)
    def next_missing_fact(patient_id: str) -> str:
        """The next question a pharmacist should ask for a patient: the missing fact, who to ask, the exact
        wording, and the fact ID to pass to which_findings_depend_on. patient_id looks like "syn-p1"."""
        return run(tools.next_missing_fact, patient_id)

    @mcp.tool(annotations=READ)
    def inspect_episode(episode_id: str) -> str:
        """One medication episode: medicine, dose, start and stop days, the reason on record, sources, and
        the findings that use it. episode_id looks like "syn-p1:ep-furosemide"."""
        return run(tools.inspect_episode, episode_id)

    @mcp.tool(annotations=READ)
    def which_findings_depend_on(patient_id: str, fact_id: str) -> str:
        """Which findings depend on one fact, so would be evaluated again if it changed. Read-only.
        fact_id looks like "syn-p1:ep-furosemide" or "syn-p1:obs-ankle-swelling"."""
        return run(tools.which_findings_depend_on, patient_id, fact_id)

    @mcp.tool(annotations=READ)
    def prepare_packet(patient_id: str) -> str:
        """The review packet for a clinician: every finding with its evidence, open questions and reviews."""
        return run(tools.prepare_packet, patient_id)

    if writes_allowed() if allow_writes is None else allow_writes:

        @mcp.tool(annotations=WRITE)
        def ask_question(requirement_id: str) -> str:
            """Record that the question for one open requirement was asked (template wording). Synthetic
            stories only. requirement_id looks like "syn-p1:req-furosemide-indication"."""
            return run(tools.ask_question, requirement_id)

        @mcp.tool(annotations=WRITE)
        def run_review_agent(finding_id: str) -> str:
            """Run FirstDomino's bounded review agent on one finding: it gathers the evidence, drafts the
            question and the packet text. It never creates or changes findings. Synthetic stories only."""
            return run(tools.run_review_agent, finding_id)

    return mcp


def main() -> None:
    build_server().run("stdio")
