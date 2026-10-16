# FirstDomino

Built for **Graph Hacks** (WeMakeDevs x FalkorDB, 15-18 Oct 2026).

FirstDomino reconstructs a **synthetic** patient's medication story across visits, finds **possible**
prescribing cascades from a few curated, cited patterns, and asks for the missing evidence a clinician
needs to review them. Findings are possible patterns, never causes.

- **Primary user:** a pharmacist doing a medication review.
- **The caregiver** supplies facts. **The clinician** decides.
- **FalkorDB** holds every fact, finding, question and review, with versions.

## Docs

- [docs/data-model.md](docs/data-model.md): graph labels, relationships, statuses, named queries
- [docs/api.md](docs/api.md): endpoints with JSON examples
- [docs/deploy.md](docs/deploy.md): the API on Railway (commands, variables by name, checks)
- Contract types: `api/models.py` (pydantic), mirrored in `web/lib/types.ts`
- Fixtures: `data/stories/*.json` (3 synthetic stories), `data/patterns/*.json` (cited patterns)
- API snapshots for the web app: `data/snapshots/fixtures.json` (`make snapshots`)

## Ownership

| Area | Owner |
|---|---|
| `engine/` (queries, rules, loaders), `api/` | Dev |
| `web/`, `agent/` | Ajay |
| `data/`, `docs/`, contract types | shared: change them in one PR with both sides updated |

## Layout

```
api/        FastAPI (Python 3.11, uv). models.py = contracts, store.py = fixture stub, graph_store.py = FalkorDB (FD_STORE=graph), main.py = routes
engine/     queries/*.cypher (named, parameterised; write/ + admin/ for loads), cypher.py, db.py, rules.py, evaluate.py, loaders/
agent/      one bounded review agent; tools.py holds the allowlist
web/        Next.js 15 + TypeScript + Tailwind + shadcn/ui + framer-motion. lib/api.ts is the ONE adapter
data/       patterns/, stories/ (synthetic fixtures), cases/, snapshots/
docs/       data-model.md, api.md
mcp/        reserved for the MCP server
tests/      pytest: API behaviour + contract guards
```

## Commands

`make up | down | seed | reseed | test | test-stack | test-restart | lint | snapshots | dev-api | dev-web`.
Without `make` (e.g. on Windows): `uv run pytest`, `uv run ruff check .`, `uv run uvicorn api.main:app --reload`,
`cd web && npm run dev`, `docker compose --profile test run --rm --build api-test`.

Docker Compose runs the API with `FD_STORE=graph` (FalkorDB). Without it the API serves the fixtures.

Web data source: `NEXT_PUBLIC_DATA_SOURCE=fixtures` (default) or `live` with `NEXT_PUBLIC_API_URL`.

## Conventions

- **Every Cypher query is a named file** in `engine/queries/` with parameters (`$pid`, `$fid`, …).
  Load it with `engine.cypher.load(name)`. Never inline Cypher and never build it with string formatting.
- **Every traversal starts from `Patient {id: $pid}`.** The server checks the caller may access that
  patient first. `tests/test_contracts.py` enforces the first `MATCH`.
- **IDs are patient-scoped**: `<patient_id>:<local id>`.
- **Dates are day numbers** (int; day 0 = first event of the story). `null` = not known.
- Every fact has `happened_at`, `recorded_at` and `state` in {documented, reported, conflicting,
  unknown}. Answers may also be `not_available`, which never means "no".
- Every write carries `case_version`. A stale one gets 409. Evidence changes carry an idempotent `event_id`.
- **The LLM never creates findings.** Only `engine/rules.py` does. The agent picks allowlisted tools
  (`agent/tools.py`) and phrases text around evidence IDs it was given, with deterministic templates as
  the fallback.
- Changing a contract type means changing `api/models.py`, `web/lib/types.ts`, the fixtures and
  `make snapshots` together. `make test` catches drift.
- All patient data is synthetic and labelled as such.

## Copy rules

Never write **"safe"**, **"stop taking"**, **"cleared"** or **"caused by"** in UI text, fixtures,
API strings or agent output. Say "possible pattern", "worth reviewing", "documented", "reported by
the caregiver", "not known yet". Medicine changes are the prescribing clinician's decision.
`tests/test_contracts.py::test_copy_rules` scans `data/`, `api/`, `agent/` and `web/`.
