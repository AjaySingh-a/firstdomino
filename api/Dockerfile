# Build context: repo root (see docker-compose.yml).
FROM python:3.11-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY api ./api
COPY engine ./engine
COPY agent ./agent
COPY data ./data
ENV PATH="/app/.venv/bin:$PATH"

# The same image plus pytest: runs the graph and stack tests inside the compose network
# (`make test-stack`). Not used by the api service.
FROM base AS test
RUN uv sync --frozen
COPY tests ./tests
CMD ["pytest", "-q", "tests/test_graph.py", "tests/test_stack.py"]

FROM base AS runtime
EXPOSE 8000
# Railway (and other hosts) set PORT; exec keeps uvicorn as PID 1 so it gets the stop signal.
CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
