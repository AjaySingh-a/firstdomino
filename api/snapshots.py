"""Write the stub API's responses to data/snapshots/fixtures.json.

web/lib/api.ts reads this file in fixture mode, so the web app sees exactly what
the API returns. Regenerate after changing stories or the store:

    uv run python -m api.snapshots
"""

from __future__ import annotations

import json

from api.store import DATA_DIR, FixtureStore, load_patterns, load_stories

SNAPSHOT = DATA_DIR / "snapshots" / "fixtures.json"


def build() -> dict:
    stories, patterns = load_stories(), load_patterns()
    store = FixtureStore(stories, patterns)
    dump = lambda m: m.model_dump(mode="json")  # noqa: E731
    out: dict = {
        "_generated_by": "uv run python -m api.snapshots",
        "synthetic": True,
        "health": {"status": "ok", "mode": "fixtures", "falkordb": "not_used"},
        "patients": [dump(p) for p in store.patients()],
        "cases": {},
    }
    for pid, story in stories.items():
        evidence = {}
        for req in story.pending_evidence:
            fresh = FixtureStore(stories, patterns)
            evidence[req.event_id] = {
                "request": dump(req),
                "result": dump(fresh.submit_evidence(pid, req)),
                "findings_after": dump(fresh.findings(pid)),
            }
        out["cases"][pid] = {
            "timeline": dump(store.timeline(pid)),
            "findings": dump(store.findings(pid)),
            "investigations": {f.id: dump(store.investigation(f.id)) for f in story.findings},
            "packet": dump(store.packet(pid)),
            "evidence": evidence,
        }
    return out


def render() -> str:
    return json.dumps(build(), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(render(), encoding="utf-8", newline="\n")
    print(f"wrote {SNAPSHOT}")
