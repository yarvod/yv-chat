.PHONY: dev down logs backend-install backend-dev backend-lint backend-format \
	backend-typecheck backend-test frontend-install frontend-dev frontend-lint \
	frontend-typecheck frontend-test frontend-build migrate migration-sql bootstrap-admin \
	test ci compose-check deploy-check docs-check

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
	BACKEND_IMAGE=ghcr.io/example/yv-chat-backend \
	FRONTEND_IMAGE=ghcr.io/example/yv-chat-frontend \
	IMAGE_TAG=sha-test \
	POSTGRES_DB=yv_chat \
	POSTGRES_USER=yv_chat \
	POSTGRES_PASSWORD=test-only \
	DATABASE_URL=postgresql+asyncpg://yv_chat:test-only@postgres:5432/yv_chat \
	docker compose -p yv-chat -f compose.prod.yml config --quiet

deploy-check:
	sh -n deploy/remote-deploy.sh
	sh -n deploy/bootstrap-server.sh
	grep -q '127.0.0.1:$${YV_CHAT_BIND_PORT:-18080}:80' compose.prod.yml
	grep -q '172.30.242.10/32' compose.prod.yml
	grep -q '^  cleanup:' compose.prod.yml
	grep -q 'messenger.cleanup_messages' compose.prod.yml
	grep -q 'compose pull postgres api cleanup frontend gateway' deploy/remote-deploy.sh
	grep -q 'server_name chat.yoowee.ru' deploy/nginx/host-chat.http.conf
	grep -q 'Strict-Transport-Security' deploy/nginx/host-chat.conf
	grep -q 'proxy_pass http://127.0.0.1:18080' deploy/nginx/host-chat.conf
	ssh-keygen -l -f deploy/ssh_known_hosts >/dev/null
	! grep -q 'StrictHostKeyChecking=no' .github/workflows/deploy.yml
	! grep -Eq 'docker system prune|docker compose down|--remove-orphans' deploy/remote-deploy.sh deploy/bootstrap-server.sh

docs-check:
	test "$$(grep -c '^## WP-' docs/workplan.md)" -eq 1
	grep -q 'Статус: \*\*accepted for protocol; implementation release-gated\*\*' docs/adr/0001-e2ee-mls.md
	grep -q 'https://www.rfc-editor.org/rfc/rfc9420.html' docs/adr/0001-e2ee-mls.md
	grep -q 'https://www.rfc-editor.org/rfc/rfc9750.html' docs/adr/0001-e2ee-mls.md
	grep -q 'не шифрует сообщения и не является E2EE' README.md

ci: backend-lint backend-typecheck backend-test frontend-lint frontend-typecheck frontend-test frontend-build compose-check deploy-check docs-check
