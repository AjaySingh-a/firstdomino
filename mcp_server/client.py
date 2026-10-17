"""The MCP server's only way to FirstDomino: its HTTP API. No Cypher and no graph access here."""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_API_URL = "https://api-production-b29f.up.railway.app"


class ApiError(Exception):
    """A FirstDomino API call that did not succeed, worded for the person reading the tool result."""

    def __init__(self, message: str, status: int | None = None, body: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.body = body or {}


class FirstDominoAPI:
    """A thin client over the FirstDomino API. `client` is injectable so tests can fake the HTTP layer."""

    def __init__(self, base_url: str | None = None, client: httpx.Client | None = None):
        self.base_url = (base_url or os.environ.get("FD_API_URL") or DEFAULT_API_URL).rstrip("/")
        self._http = client or httpx.Client(base_url=self.base_url, timeout=30.0)

    def get(self, path: str) -> Any:
        return self._call("GET", path)

    def post(self, path: str, body: dict[str, Any]) -> Any:
        return self._call("POST", path, body)

    def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        try:
            r = self._http.request(method, path, json=body)
        except httpx.HTTPError as exc:
            raise ApiError(
                f"Could not reach the FirstDomino API at {self.base_url} ({type(exc).__name__})."
            ) from exc
        if r.status_code < 400:
            return r.json()
        try:
            err = r.json()
        except ValueError:
            err = {}
        raise ApiError(_explain(r.status_code, err), r.status_code, err)


def _explain(status: int, err: dict[str, Any]) -> str:
    detail = err.get("detail")
    if status == 404:
        return f"Not found: {detail or 'that ID'}. list_stories shows the synthetic stories and their IDs."
    if status == 409:
        return (
            f"The case changed while this ran (version sent {err.get('sent')}, now {err.get('current')}). "
            "Run the tool again to use the current version."
        )
    if status == 503:
        return "The FirstDomino API is up but cannot reach its graph right now. Try again shortly."
    if status == 422:
        return f"The FirstDomino API did not accept that request: {detail}"
    return f"The FirstDomino API answered {status}: {detail or 'no detail'}."
