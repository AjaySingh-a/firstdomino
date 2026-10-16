"""One structured-output call to an OpenAI-compatible chat API in json_object mode (Groq by default).

Env: LLM_API_KEY (no key -> no LLM, the agent uses its templates), FD_AGENT_MODEL, LLM_BASE_URL, and
FD_AGENT_FALLBACK_MODEL: used for the rest of the pass once the main model answers 429 (quota), 5xx
(e.g. 503 "high demand") or times out. Free tiers allow few requests per model, and a pass makes up
to six calls, so a second model keeps the demo going.
The key goes in the Authorization header only. It is never printed, logged or stored.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Protocol

DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "openai/gpt-oss-120b"
TIMEOUT_S = 20
# Cloudflare in front of Groq answers 403 (error 1010) to urllib's default "Python-urllib/3.x" agent.
USER_AGENT = "firstdomino-agent/0.1"
# Worth trying another model for: rate limit or quota, server trouble, no answer in time.
TRANSIENT = {"http_429", "http_500", "http_502", "http_503", "http_504", "timeout", "unreachable"}


class LLMError(Exception):
    """The call failed. `reason` is a short code (http_401, http_429, timeout, invalid_json, ...); the
    message never holds the key."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason

    @property
    def transient(self) -> bool:
        return self.reason in TRANSIENT


class LLM(Protocol):
    model: str

    def complete_json(self, system: str, user: str) -> str:
        """Return the model's reply: text that should be one JSON object."""
        ...


class OpenAICompatLLM:
    def __init__(self, base_url: str, api_key: str, model: str, fallback_model: str | None = None):
        self.base_url = base_url.rstrip("/")
        self._key = api_key
        self.models = [model] + ([fallback_model] if fallback_model and fallback_model != model else [])
        self._current = 0

    @property
    def model(self) -> str:
        return self.models[self._current]

    def __repr__(self) -> str:  # never show the key
        return f"OpenAICompatLLM(base_url={self.base_url!r}, models={self.models!r})"

    def complete_json(self, system: str, user: str) -> str:
        """One call. On a transient failure of the main model, the fallback model answers instead, and
        stays in use for later calls (the main one is likely still busy or out of quota)."""
        try:
            return self._call(self.model, system, user)
        except LLMError as e:
            if not e.transient or self._current + 1 >= len(self.models):
                raise
            self._current += 1
            return self._call(self.model, system, user)

    def _call(self, model: str, system: str, user: str) -> str:
        body = {
            "model": model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._key}",
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
                payload = json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 400 and _error_code(e) == "json_validate_failed":
                # Groq's json_object mode: the model wrote invalid JSON. A bad reply, not a bad key or
                # model, so it is retried like any other rejected reply.
                raise LLMError("invalid_json", f"{model} did not produce valid JSON (HTTP 400)") from None
            raise LLMError(f"http_{e.code}", f"{model} answered HTTP {e.code}") from None
        except TimeoutError:
            raise LLMError("timeout", f"{model} did not answer in {TIMEOUT_S}s") from None
        except urllib.error.URLError as e:
            if isinstance(e.reason, TimeoutError):
                raise LLMError("timeout", f"{model} did not answer in {TIMEOUT_S}s") from None
            raise LLMError("unreachable", f"LLM endpoint unreachable ({type(e.reason).__name__})") from None
        except OSError as e:
            raise LLMError("unreachable", f"LLM endpoint unreachable ({type(e).__name__})") from None
        except json.JSONDecodeError:
            raise LLMError("invalid_json", f"{model} sent a response that was not JSON") from None
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise LLMError("invalid_json", f"{model} sent no message content") from None
        if not isinstance(content, str) or not content.strip():
            raise LLMError("invalid_json", f"{model} sent an empty reply")
        return content


def _error_code(e: urllib.error.HTTPError) -> str | None:
    """The provider's error.code from an error body, if any. Only the code is kept."""
    try:
        err = json.loads(e.read().decode("utf-8", errors="replace")).get("error")
        return err.get("code") if isinstance(err, dict) else None
    except (OSError, ValueError, AttributeError):
        return None


def llm_from_env() -> LLM | None:
    key = os.environ.get("LLM_API_KEY", "").strip()
    if not key:
        return None
    return OpenAICompatLLM(
        base_url=os.environ.get("LLM_BASE_URL", "").strip() or DEFAULT_BASE_URL,
        api_key=key,
        model=os.environ.get("FD_AGENT_MODEL", "").strip() or DEFAULT_MODEL,
        fallback_model=os.environ.get("FD_AGENT_FALLBACK_MODEL", "").strip() or None,
    )
