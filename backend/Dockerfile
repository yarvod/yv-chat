FROM ghcr.io/astral-sh/uv:0.8.0 AS uv

FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_CACHE_DIR=/tmp/uv-cache

WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
COPY alembic.ini ./
COPY migrations ./migrations
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH" \
    UV_CACHE_DIR=/tmp/uv-runtime-cache \
    UV_NO_SYNC=1

USER 65532:65532

EXPOSE 8000

CMD ["uvicorn", "messenger.main:app", "--host", "0.0.0.0", "--port", "8000"]
