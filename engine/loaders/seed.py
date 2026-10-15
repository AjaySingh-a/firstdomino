"""Seed FalkorDB with the synthetic stories. Owner: Dev.

For now this validates every fixture against the contract types and reports what
it would load. Graph writes (kb_template copied into family_<id> graphs) come next.

    uv run python -m engine.loaders.seed [--reset]
"""

from __future__ import annotations

import sys

from api.store import load_patterns, load_stories


def main(argv: list[str]) -> int:
    patterns = load_patterns()
    stories = load_stories()
    print(f"patterns: {len(patterns)} valid ({', '.join(patterns)})")
    for pid, s in stories.items():
        print(
            f"{pid}: {len(s.episodes)} episodes, {len(s.observations)} observations, "
            f"{len(s.findings)} findings, case_version {s.patient.case_version} [SYNTHETIC]"
        )
    mode = "reset + load" if "--reset" in argv else "load"
    print(f"graph {mode}: not implemented yet - fixtures validated only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
