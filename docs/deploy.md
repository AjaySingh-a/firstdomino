# Deploy: the API on Railway, the web app on Vercel

The FirstDomino API runs on [Railway](https://railway.com) next to a FalkorDB service, in the project
**firstdomino**, environment **production**.

- **Public API:** https://api-production-b29f.up.railway.app (for example `/health`, `/patients`).
- **Web app (Vercel):** https://firstdomino-web.vercel.app (see "The web app on Vercel" below).

Every value below is a name, a reference or a public setting. **Never put a secret value in this file,
in a commit or in a terminal log.** Secrets live in Railway's (and Vercel's) variables only.

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
| `FD_CORS_ORIGINS` | `http://localhost:3001,https://firstdomino-web.vercel.app` (comma-separated) |
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

### Why `main` stopped deploying (found 2026-10-18)

- **Symptom:** after PR #14 merged, live `/lab/palette` answered 404 and the web app's lab said "The API
  is not reachable right now". `railway deployment list --service api` showed no deploy after
  2026-10-16 16:08 (`50ac1de`, PR #7): none of PRs #8–#16 had deployed the API.
- **Cause:** the service's saved source had the repo but **no branch**
  (`railway environment config --json` → `source: {"repo": "AjaySingh-a/firstdomino"}`). Without a
  branch Railway has no push trigger, so merges to `main` built nothing. The 2026-10-16 build of
  `main` came from running `railway service source connect` by hand (step 4), not from a push. It is
  the same "the branch did not stick" problem as `railway add --branch` in step 1.
- **What we ran:** `railway service source connect --repo AjaySingh-a/firstdomino --branch main --service api`
  again (CLI 5.70.0). That started a build of `main` (`c4f0840`) at once, and the lab routes went live.
- **Not fixed by that:** PRs #17–#23 merged afterwards and still triggered no deploy. The saved source
  still shows no branch, so the push trigger is still missing. Check in the dashboard: **api →
  Settings → Source** should show branch `main`, and the Railway GitHub app needs access to
  `AjaySingh-a/firstdomino`.
- **Until then, after every merge that touches the API** (`api/`, `engine/`, `agent/`, `data/`,
  `pyproject.toml`, `uv.lock`, `railway.json`): run the `source connect` line above, or press
  **Deploy** on the `api` service. Then check `railway deployment list --service api --json` for the
  merged commit and `/health`. Web-only merges need nothing on Railway, because Vercel deploys them.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build log: `Railpack … No start command detected` | The deployed commit has no `railway.json` (see "the branch" above). |
| `/health` → `"falkordb": "down"`, data routes → 503 | `FALKORDB_URL` is missing or wrong, or FalkorDB is restarting. The private hostname resolves only inside the project. |
| `/health` → `"appendonly": "no"` | `REDIS_ARGS` on FalkorDB lost `--appendonly yes`. |
| Agent steps show `fallback_reason: no_key` | `LLM_API_KEY` is not set on `api`, or was added without a redeploy. |
| `fallback_reason: http_403` | Groq's Cloudflare blocks the request; the client sends its own `User-Agent` for this. |
| `fallback_reason: rate_limited` | More than 10 agent runs a minute from one address. |

## The web app on Vercel

The web app (`web/`, Next.js 15) runs on [Vercel](https://vercel.com) as the project
**firstdomino-web** (scope `ajay-singhs-projects-cda96a16`).

- **Production:** https://firstdomino-web.vercel.app
- **API:** it calls the Railway API above from the browser (`NEXT_PUBLIC_DATA_SOURCE=live`).
- **Git:** the project is connected to GitHub `AjaySingh-a/firstdomino`. A push to `main` makes a
  production deploy; other branches get previews.

### Project settings

| Setting | Value | Why |
|---|---|---|
| Root directory | `web` | The Next.js app lives there. |
| Include files outside the root directory in the Build Step (`sourceFilesOutsideRootDirectory`) | **on** | `prebuild` runs `scripts/sync-fixtures.mjs`, which copies `../data/snapshots/fixtures.json` and `../engine/queries/*.cypher` into `web/lib/fixtures/`. That folder is gitignored, so the copies are never committed and cannot drift from the source. |
| Framework | Next.js | |
| Node.js | 24.x (Vercel default) | |
| Deployment Protection | Vercel default (`all_except_custom_domains`) | Previews need a Vercel login. The production URL is public. |

Two safeguards in the code:

- **Missing sources:** if `../data` or `../engine` is missing, `sync-fixtures` fails with a message
  that names the setting above.
- **NODE_ENV:** `npm run build` runs `scripts/build.mjs`, which starts `next build` with
  `NODE_ENV=production` whatever the calling shell has set. A shell with `NODE_ENV=development`
  would otherwise build React's development bundle.

The root `.vercelignore` keeps `.venv`, `node_modules`, `.next`, tests and every `.env*` file out
of the upload.

### Environment variables (Production and Preview; not secret)

| Name | Value |
|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `live` |
| `NEXT_PUBLIC_API_URL` | `https://api-production-b29f.up.railway.app` |

They are inlined at **build** time, so changing one needs a redeploy.

### Steps

Run all of these from the **repo root**, not from `web/`, so the build can see `../data` and
`../engine`.

```bash
npm i -g vercel            # used: Vercel CLI 64.3.1
vercel login               # interactive: browser / device code
vercel whoami

vercel project add firstdomino-web            # (newer CLIs: `vercel project create`)
vercel link --project firstdomino-web --yes   # writes .vercel/ and a .env.local (both gitignored)

# root directory + files outside it, through the REST API
vercel api /v9/projects/firstdomino-web -X PATCH \
  -f rootDirectory=web -F sourceFilesOutsideRootDirectory=true -f framework=nextjs

for t in production preview; do
  vercel env add NEXT_PUBLIC_DATA_SOURCE $t --value live --no-sensitive --yes --force
  vercel env add NEXT_PUBLIC_API_URL $t --value https://api-production-b29f.up.railway.app --no-sensitive --yes --force
done

vercel git connect https://github.com/AjaySingh-a/firstdomino.git --yes   # production branch: main
vercel deploy --prod --yes                     # -> aliased to https://firstdomino-web.vercel.app
```

The build log shows the sync working on Vercel:
`fixtures: snapshot + 10 queries -> /vercel/path0/web/lib/fixtures`, then `copy-lint: ok`.

**Windows / PowerShell:** PowerShell drops a bare `--`. Write `vercel env run '--' node …`.

### CORS on the Railway API

The browser calls the API from the web app's origin, so that origin must be listed on the Railway
`api` service:

```bash
railway variable set 'FD_CORS_ORIGINS=http://localhost:3001,https://firstdomino-web.vercel.app' --service api
```

- **Format:** `FD_CORS_ORIGINS` is a comma-separated list. Spaces and a trailing `/` are ignored
  (`api.main.cors_origins`).
- **Redeploy:** setting the variable redeploys the api.
- **Check:** a preflight from `https://firstdomino-web.vercel.app` and from `http://localhost:3001`
  gets `access-control-allow-origin` back; any other origin gets 400.
- **Previews:** each preview URL is a new origin and is not on this list. A preview that should
  call the live API needs its origin added, or a fixtures-mode build.

### Verified on production (2026-10-16)

| Check | Result |
|---|---|
| Landing page | 3 story cards from the live API, each labelled with what it shows; statuses Needs evidence / Competing explanation / Reviewed |
| Story 1 workspace | `data live`, case v2; Medication River, investigation drawer, 3-step hint, next question |
| Run review agent (drawer) | 6/6 steps ok, "Text phrased by the model", question recorded; case v2 → v3 |
| Answer the next question ("ankle swelling", reported by the caregiver) | case v3 → v4; finding → revision 2 `candidate` ("Possible pattern"); no open question left |
| Sandbox edit (ankle swelling onset day 21 → 25) | case v4 → v5, revision 3 |
| Sandbox "Reset all stories" | back to case v2, revision 1, Needs evidence |
| `/packet/syn-p1` | timeline, unresolved question, finding, fact states from the record, next conversation, Share link / Print |
| Preview built with `--build-env NEXT_PUBLIC_API_URL=https://firstdomino-no-such-api.invalid` | landing and story 1 show **Evaluation unavailable**, "This is not a 'no pattern' result", "The evaluation service could not be reached". No empty list. The preview was then removed with `vercel remove`. |

**Opening a protected preview from automation:** don't turn off Deployment Protection. Use
`vercel curl <preview-url>` for HTTP checks. For a browser, add the header
`x-vercel-trusted-oidc-idp-token` to requests to the preview's own host only. Get the token with
`vercel env run '--' <command>`, which provides `VERCEL_OIDC_TOKEN`. Never print or commit it.

### Web troubleshooting

| Symptom | Likely cause |
|---|---|
| Build: `sync-fixtures: data/snapshots/fixtures.json is missing next to web/` | "Include files outside the root directory" is off, or the deploy ran from `web/` instead of the repo root. |
| Pages show "Evaluation unavailable" in production | The API is down (check `/health`) or `NEXT_PUBLIC_API_URL` is wrong (it is fixed at build time; redeploy after changing it). |
| Browser console: CORS error | The web app's origin is missing from `FD_CORS_ORIGINS` on Railway. |
| A preview opens a Vercel login page | Deployment Protection (expected for previews). |
