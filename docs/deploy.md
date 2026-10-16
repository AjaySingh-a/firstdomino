# Deploy: the API on Railway

The FirstDomino API runs on [Railway](https://railway.com) next to a FalkorDB service, in the project
**firstdomino**, environment **production**.

- **Public API:** https://api-production-b29f.up.railway.app (for example `/health`, `/patients`).
- **The web app is not deployed here.** Point it at this URL with `NEXT_PUBLIC_DATA_SOURCE=live` and
  `NEXT_PUBLIC_API_URL`.

Every value below is a name, a reference or a public setting. **Never put a secret value in this file,
in a commit or in a terminal log.** Secrets live in Railway's variables only.

## Services

| Service | What | Networking |
|---|---|---|
| `FalkorDB` | Railway's official FalkorDB template, with a volume. AOF is on through `REDIS_ARGS`. Not changed by this deploy. | Private only: `falkordb.railway.internal:16379`. No public TCP proxy. |
| `api` | This repo, built from `api/Dockerfile` (the `runtime` stage). | Public domain on port 8000. |

The FalkorDB service's variables (names only): `FALKORDB_ARGS`, `FALKORDB_PASSWORD`, `FALKORDB_PORT`,
`FALKORDB_PRIVATE_URL`, `FALKORDB_PUBLIC_URL` (unused), `PORT` (3000, the FalkorDB Browser) and
`REDIS_ARGS`.

## What the code does for Railway

- **Connection:** `engine/db.py` reads `FALKORDB_URL` (`redis://[user:password@]host:port`) and
  prefers it over `FALKORDB_HOST` / `FALKORDB_PORT` / `FALKORDB_PASSWORD`. The URL is never logged
  or echoed in an error.
- **Port:** `api/Dockerfile` runs `exec uvicorn … --port ${PORT:-8000}`, so uvicorn is PID 1 and
  receives the stop signal.
- **`railway.json` (config as code):**
  - Dockerfile builder, `api/Dockerfile`;
  - health check `/health` with a 120 s timeout;
  - restart on failure, up to 10 times.
  - The CLI warns that config as code is deprecated in favour of `.railway/railway.ts`. Existing
    files keep working until **2026-12-01**; migrate with `railway config migrate` before then.
- **Boot:**
  - The API seeds `kb_template` and stories 1-3 into `family_demo` if they are missing, from the
    files in the image, with no network.
  - **On Railway, `GRAPH.COPY` fails** (the server cannot fork), so the seeder loads the knowledge
    straight into the family graph. The log shows: `GRAPH.COPY of kb_template failed; loading the
    knowledge into family_demo directly`.
  - A patient already in the graph is never reloaded, so restarts keep confirmed evidence.
- **FalkorDB unreachable:**
  - The API still boots after `FD_DB_WAIT_SECONDS` (30 s).
  - `/health` answers 200 with `"status": "degraded", "falkordb": "down"`.
  - Every data route answers **503** `{"error": "evaluation_unavailable"}`, never an empty list.
  - The first request that reaches FalkorDB seeds it.
- **`/health`:** `{"status", "mode", "falkordb": "up"|"down", "appendonly": "yes"|"no"|"unknown"}`.
  `appendonly` comes from `CONFIG GET appendonly`. No secrets.
- **Review agent limits:**
  - `POST /findings/{id}/review-agent` allows 10 LLM-backed runs per minute per client IP
    (`FD_AGENT_RATE_PER_MIN`). The client IP is `X-Real-IP`, else the right-most `X-Forwarded-For`
    entry.
  - Over the limit, the pass runs on templates with `fallback_reason: "rate_limited"`.
  - The limit lives in memory, so it is per API process.

## Variables on `api`

| Name | Value |
|---|---|
| `FALKORDB_URL` | `${{FalkorDB.FALKORDB_PRIVATE_URL}}` (a reference; Railway fills it in) |
| `FD_STORE` | `graph` |
| `FD_FAMILY` | `demo` |
| `FD_STORIES` | `1 2 3` |
| `PORT` | `8000` |
| `FD_CORS_ORIGINS` | `http://localhost:3001` (add the deployed web app's origin, comma-separated) |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
| `FD_AGENT_MODEL` | `openai/gpt-oss-120b` |
| `FD_AGENT_FALLBACK_MODEL` | `openai/gpt-oss-20b` |
| `LLM_API_KEY` | **secret: added in the dashboard only** (see below) |

Optional, with defaults: `FD_AGENT_RATE_PER_MIN` (10), `FD_DB_WAIT_SECONDS` (30),
`FD_DB_CONNECT_TIMEOUT` (5), `FD_DB_TIMEOUT` (30).

## Steps

### 0. Locally, before deploying

```bash
docker compose up -d falkordb
uv run pytest                      # includes the FalkorDB tests
uv run ruff check .
docker compose up -d --build --wait api
FD_API_URL=http://localhost:8000 uv run pytest -q tests/test_stack.py
```

### 1. CLI: link, add the service, set variables, add a domain

```bash
railway --version                  # used: 5.69.0
railway whoami
railway link --project firstdomino --environment production

# Names only. `--json` and `--kv` print raw values, so filter them: never print the output as is.
railway variable list --service FalkorDB --json | python -c "import json,sys; print(sorted(json.load(sys.stdin)))"

railway add --service api --repo AjaySingh-a/firstdomino --branch d4-deploy \
  --variables 'FALKORDB_URL=${{FalkorDB.FALKORDB_PRIVATE_URL}}' \
  --variables 'FD_STORE=graph' \
  --variables 'FD_FAMILY=demo' \
  --variables 'FD_STORIES=1 2 3' \
  --variables 'PORT=8000' \
  --variables 'FD_CORS_ORIGINS=http://localhost:3001' \
  --variables 'LLM_BASE_URL=https://api.groq.com/openai/v1' \
  --variables 'FD_AGENT_MODEL=openai/gpt-oss-120b' \
  --variables 'FD_AGENT_FALLBACK_MODEL=openai/gpt-oss-20b'

railway domain --service api --port 8000      # -> https://api-production-b29f.up.railway.app
```

Single quotes keep the shell from touching `${{…}}`.

**Gotcha: the branch.** `railway add --branch` did not stick. The service's saved source has the
repo but no branch, so Railway deploys the default branch (`main`). Two consequences:

- Before `railway.json` is on `main`, a build from `main` has no Dockerfile setting. Railpack then
  fails with "No start command detected".
- A deploy triggered from the dashboard (for example after adding a variable) builds `main` too.

To deploy a branch on demand:

```bash
railway service source connect --repo AjaySingh-a/firstdomino --branch d4-deploy --service api
railway service status --service api --json      # BUILDING -> SUCCESS
```

`railway environment edit --service-config <service> source.branch …` answered "No changes to
apply" with CLI 5.69.0. Once this branch is merged, `main` carries `railway.json` and the default
branch is the right one (step 4).

### 2. Dashboard: add the LLM key (never through the CLI or a commit)

1. Open railway.com, then project **firstdomino**, environment **production**.
2. Click the **api** service, then the **Variables** tab.
3. Click **+ New Variable**. Name `LLM_API_KEY`, value: the Groq key. Click **Add**.
4. If the top banner says **Apply 1 change**, click it, then **Deploy**.

Check that it is set without printing it:

```bash
railway variable list --service api --json | python -c "import json,sys; d=json.load(sys.stdin); print('LLM_API_KEY set:', bool(d.get('LLM_API_KEY','').strip()))"
```

### 3. Verify the live URL

| Check | Result (2026-10-16) |
|---|---|
| `GET /health` | `{"status":"ok","mode":"graph","falkordb":"up","appendonly":"yes"}` |
| `GET /patients` | `syn-p1` v2, `syn-p2` v2, `syn-p3` v4, all `synthetic: true` |
| `GET /patients/syn-p1/findings` | `syn-p1:fnd-ccb-edema-loop-1` `needs_evidence` |
| `POST /patients/syn-p3/evidence` (the story's pending onset correction) | v4 → v5, revision 2 `needs_reassessment`; resending the same `event_id` → `replayed: true` |
| `POST /sandbox/reset` | `syn-p3` back to v4 `reviewed` |
| `GET /patients/nobody/timeline` | 404 |
| `POST /findings/syn-p1:fnd-ccb-edema-loop-1/review-agent` | `phrasing: "llm"`, 6 steps, all ok; `syn-p1` v3 |
| `GET /patients/syn-p1/agent-steps` | 7 steps (the seeded one plus `run-1-step-1` … `run-1-step-6`) |
| `railway restart --service api --yes`, then the same reads | identical: `syn-p1` v3 with 7 steps, `syn-p2` v2, `syn-p3` v4 |

`railway restart` can sit waiting after the restart. Check `railway service status --service api
--json` and the data rather than waiting on it.

### 4. After the PR is merged: deploy from `main`

```bash
railway service source connect --repo AjaySingh-a/firstdomino --branch main --service api
railway service status --service api --json      # BUILDING -> SUCCESS
```

From then on, a push to `main` deploys the API. Check `/health` again afterwards.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build log: `Railpack … No start command detected` | The deployed commit has no `railway.json` (see "the branch" above). |
| `/health` → `"falkordb": "down"`, data routes → 503 | `FALKORDB_URL` is missing or wrong, or FalkorDB is restarting. The private hostname resolves only inside the project. |
| `/health` → `"appendonly": "no"` | `REDIS_ARGS` on FalkorDB lost `--appendonly yes`. |
| Agent steps show `fallback_reason: no_key` | `LLM_API_KEY` is not set on `api`, or was added without a redeploy. |
| `fallback_reason: http_403` | Groq's Cloudflare blocks the request; the client sends its own `User-Agent` for this. |
| `fallback_reason: rate_limited` | More than 10 agent runs a minute from one address. |
