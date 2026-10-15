"""The review agent's allowlist. Owner: Ajay. Not implemented yet.

The agent only picks from these tools and phrases text around evidence IDs it was
given. It never creates or changes findings. Deterministic templates are the fallback
when the LLM call fails or returns text that cites IDs it was not given.
"""

from __future__ import annotations

from typing import get_args

from api.models import AgentTool

ALLOWLIST: tuple[str, ...] = get_args(AgentTool)
