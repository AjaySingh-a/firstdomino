"""The review agent's allowlist. Owner: Ajay.

The agent only picks from these six tools and phrases text around evidence IDs it was given. It never
creates or changes findings, never answers a question and never writes evidence or decisions.
Deterministic templates are the fallback when the LLM call fails or returns text that cites IDs it
was not given.

Each agent tool is recorded as an AgentStep under one of the contract's AgentTool names
(api/models.py); the agent-level name travels in `args.agent_tool`.
"""

from __future__ import annotations

from typing import get_args

from api.models import AgentTool

ALLOWLIST: tuple[str, ...] = get_args(AgentTool)

# agent tool -> contract AgentTool. Every read goes through the API's store; the only write is
# ask_question (POST /questions), which records that a question was asked, never its answer.
TOOL_MAP: dict[str, AgentTool] = {
    "inspect_episode": "get_investigation",  # one medication episode on the timeline
    "get_evidence_pack": "get_investigation",  # GET /findings/{id}/investigation (Q4)
    "next_missing_fact": "get_next_question",  # the next open requirement (Q2)
    "ask_question": "draft_question_text",  # POST /questions, text phrased by the agent or the template
    "request_reevaluation": "get_investigation",  # read-only Q3: which findings depend on a fact
    "prepare_packet": "draft_packet_text",  # GET /patients/{id}/packet, plus the next-conversation text
}

AGENT_TOOLS: tuple[str, ...] = tuple(TOOL_MAP)

# What each tool takes. The agent fills the patient and finding itself; these are the only args a
# model may choose, and every value must be an ID it has already seen in a tool result.
TOOL_ARGS: dict[str, tuple[str, ...]] = {
    "inspect_episode": ("episode_id",),
    "get_evidence_pack": (),
    "next_missing_fact": (),
    "ask_question": ("requirement_id",),
    "request_reevaluation": ("fact_id",),
    "prepare_packet": (),
}

TOOL_HELP: dict[str, str] = {
    "inspect_episode": "Read one medication episode of this finding (start day, reason, sources).",
    "get_evidence_pack": "Read the documented, conflicting and unknown facts for this finding.",
    "next_missing_fact": "Find the next fact the pattern still needs, and who could supply it.",
    "ask_question": "Record that the question for an open requirement was asked. Write `text` as one "
    "plain question for the person named; never suggest the answer.",
    "request_reevaluation": "Read which findings depend on a fact and their current status. Changes nothing.",
    "prepare_packet": "Draft `text`: the next conversation to have with the clinician about this finding.",
}

assert set(TOOL_MAP.values()) <= set(ALLOWLIST)
