.PHONY: dev down logs backend-install backend-dev backend-lint backend-format \
	backend-typecheck backend-test frontend-install frontend-dev frontend-lint \
	frontend-typecheck frontend-test frontend-build migrate migration-sql bootstrap-admin \
	test ci compose-check

dev:
	@echo "Run 'make backend-dev' and 'make frontend-dev' in separate terminals."

down:
	docker compose -f compose.dev.yml down

logs:
	docker compose -f compose.dev.yml logs -f

backend-install:
	cd backend && uv sync --frozen

backend-dev:
	cd backend && uv run uvicorn messenger.main:app --reload --host 0.0.0.0 --port 8000

backend-lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run lint-imports

backend-format:
	cd backend && uv run ruff check --fix . && uv run ruff format .

backend-typecheck:
	cd backend && uv run mypy .

backend-test:
	cd backend && uv run pytest

migrate:
	cd backend && uv run alembic upgrade head

migration-sql:
	cd backend && uv run alembic upgrade head --sql

bootstrap-admin:
	cd backend && uv run python -m messenger.bootstrap_admin

frontend-install:
	cd frontend && npm ci

frontend-dev:
	cd frontend && npm run dev

frontend-lint:
	cd frontend && npm run lint

frontend-typecheck:
	cd frontend && npm run typecheck

frontend-test:
	cd frontend && npm test

frontend-build:
	cd frontend && npm run build

test: backend-test frontend-test

compose-check:
	docker compose -f compose.dev.yml config --quiet
	docker compose config --quiet

ci: backend-lint backend-typecheck backend-test frontend-lint frontend-typecheck frontend-test frontend-build compose-check
