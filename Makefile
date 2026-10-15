.PHONY: up down seed reseed test lint snapshots dev-api dev-web

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

lint:
	uv run ruff check .
	cd web && npm run lint

dev-api:
	uv run uvicorn api.main:app --reload --port 8000

dev-web:
	cd web && npm run dev
