.PHONY: up down seed reseed test test-stack test-restart lint snapshots bench dev-api dev-web

up:
	docker compose up -d --build

down:
	docker compose down

seed:
	uv run python -m engine.loaders.seed

reseed:
	uv run python -m engine.loaders.seed --reset

snapshots:
	uv run python -m api.snapshots

test:
	uv run pytest
	cd web && npm run typecheck

# Graph tests + HTTP tests against the api container (graph mode), inside the compose network.
test-stack:
	docker compose up -d --build --wait api
	docker compose --profile test run --rm --build api-test

# Restarts the falkordb and api containers and checks nothing was lost (runs from the host).
test-restart:
	docker compose up -d --build --wait api
	FD_API_URL=http://localhost:8000 FD_STACK_RESTART=1 uv run pytest -q tests/test_stack.py

# P2 proof suite: data/cases/*.json against the graph-mode engine on local FalkorDB -> bench/results.md
bench:
	uv run python -m bench.run

lint:
	uv run ruff check .
	cd web && npm run lint

dev-api:
	uv run uvicorn api.main:app --reload --port 8000

dev-web:
	cd web && npm run dev
