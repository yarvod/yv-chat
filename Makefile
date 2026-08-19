.PHONY: dev down logs backend-install backend-dev backend-lint backend-format \
	backend-typecheck backend-test frontend-install frontend-dev frontend-lint \
	frontend-typecheck frontend-test frontend-build migrate migration-sql bootstrap-admin \
	crypto-format crypto-lint crypto-wasm-lint crypto-test crypto-wasm crypto-wasm-bindgen \
	crypto-package crypto-feature-check crypto-check \
	test ci compose-check deploy-check docs-check

CARGO ?= cargo
WASM_BINDGEN ?= wasm-bindgen

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
	test -s frontend/.output/public/crypto/v7/yv_chat_openmls_provider_bg.wasm
	grep -q 'crypto/v7/yv_chat_openmls_provider_bg.wasm' frontend/.output/public/sw.js
	find frontend/.output/public/_nuxt -name 'device-crypto.worker-*.js' -type f | grep -q .

crypto-format:
	cd crypto && $(CARGO) fmt --check

crypto-lint:
	cd crypto && $(CARGO) clippy --all-targets --locked -- -D warnings

crypto-wasm-lint:
	cd crypto && $(CARGO) clippy --target wasm32-unknown-unknown --locked -- -D warnings

crypto-test:
	cd crypto && $(CARGO) test --locked

crypto-wasm:
	cd crypto && $(CARGO) build --target wasm32-unknown-unknown --release --locked

crypto-wasm-bindgen: crypto-wasm
	cd crypto && $(WASM_BINDGEN) \
		target/wasm32-unknown-unknown/release/yv_chat_openmls_provider.wasm \
		--target web \
		--out-dir target/wasm-bindgen \
		--typescript
	grep -q 'sealState(key: CryptoKey' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'restoreSealedState(key: CryptoKey' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'expected_fingerprint: string' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'validatePublicKeyPackage(user_id: string' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'export class SealedSnapshot' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'addMembersAndMerge(conversation_id: string' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'protectApplicationMessage(conversation_id: string' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'generateKeyPackages(count: number)' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'updateMembersAndMerge(conversation_id: string' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'applyCommitAndMerge(conversation_id: string' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'rejoinConversation(conversation_id: string' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	grep -q 'inspectConversation(conversation_id: string' crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts
	! grep -Eq 'snapshotForSealing|restoreFromUnsealedSnapshot' \
		crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts

crypto-package: crypto-wasm-bindgen
	install -d frontend/public/crypto/v7
	install -m 0644 crypto/target/wasm-bindgen/yv_chat_openmls_provider.js \
		frontend/public/crypto/v7/yv_chat_openmls_provider.js
	install -m 0644 crypto/target/wasm-bindgen/yv_chat_openmls_provider.d.ts \
		frontend/public/crypto/v7/yv_chat_openmls_provider.d.ts
	install -m 0644 crypto/target/wasm-bindgen/yv_chat_openmls_provider_bg.wasm \
		frontend/public/crypto/v7/yv_chat_openmls_provider_bg.wasm
	install -m 0644 crypto/target/wasm-bindgen/yv_chat_openmls_provider_bg.wasm.d.ts \
		frontend/public/crypto/v7/yv_chat_openmls_provider_bg.wasm.d.ts

crypto-feature-check:
	cd crypto && ! $(CARGO) tree --locked -e features -i openmls | \
		grep -Eq 'openmls feature "(content-debug|crypto-debug|test-utils)"'

crypto-check: crypto-format crypto-lint crypto-wasm-lint crypto-test crypto-package crypto-feature-check

test: backend-test frontend-test

compose-check:
	docker compose -f compose.dev.yml config --quiet
	docker compose config --quiet
	docker compose -p yv-chat-coturn -f deploy/coturn/compose.yml config --quiet
	BACKEND_IMAGE=ghcr.io/example/yv-chat-backend \
	FRONTEND_IMAGE=ghcr.io/example/yv-chat-frontend \
	IMAGE_TAG=sha-test \
	POSTGRES_DB=yv_chat \
	POSTGRES_USER=yv_chat \
	POSTGRES_PASSWORD=test-only \
	DATABASE_URL=postgresql+asyncpg://yv_chat:test-only@postgres:5432/yv_chat \
	VAPID_PUBLIC_KEY=BHZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnY \
	VAPID_PRIVATE_KEY=a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s \
	VAPID_CONTACT=mailto:test@example.test \
	docker compose -p yv-chat -f compose.prod.yml config --quiet

deploy-check:
	sh -n deploy/remote-deploy.sh
	sh -n deploy/bootstrap-server.sh
	sh -n deploy/coturn/install.sh
	sh -n deploy/coturn/certbot-renew-hook.sh
	sh -n deploy/coturn/verify.sh
	grep -q 'network_mode: host' deploy/coturn/compose.yml
	grep -q 'user: "65534:65534"' deploy/coturn/compose.yml
	grep -q 'mem_limit: 64m' deploy/coturn/compose.yml
	grep -q 'cap_drop: \["ALL"\]' deploy/coturn/compose.yml
	grep -q 'cap_add: \["NET_BIND_SERVICE"\]' deploy/coturn/compose.yml
	grep -q 'coturn/coturn:4.16.0-r0-alpine@sha256:' deploy/coturn/compose.yml
	grep -q 'denied-peer-ip=10.0.0.0-10.255.255.255' deploy/coturn/turnserver.conf.example
	grep -q 'denied-peer-ip=172.16.0.0-172.31.255.255' deploy/coturn/turnserver.conf.example
	grep -q 'denied-peer-ip=192.168.0.0-192.168.255.255' deploy/coturn/turnserver.conf.example
	! grep -q 'network_mode: host' compose.prod.yml
	grep -q '127.0.0.1:$${YV_CHAT_API_BIND_PORT:-18081}:8000' compose.prod.yml
	grep -q '127.0.0.1:$${YV_CHAT_FRONTEND_BIND_PORT:-18082}:3000' compose.prod.yml
	grep -q '172.30.243.1/32' compose.prod.yml
	! grep -q '^  gateway:' compose.prod.yml
	grep -q '^  cleanup:' compose.prod.yml
	grep -q 'messenger.cleanup_messages' compose.prod.yml
	grep -q 'compose pull postgres api cleanup frontend' deploy/remote-deploy.sh
	grep -q 'prepare_frontend_assets' deploy/remote-deploy.sh
	grep -q 'docker image ls "\$$FRONTEND_IMAGE"' deploy/remote-deploy.sh
	grep -q 'count == 10' deploy/remote-deploy.sh
	! grep -q 'for (index =' deploy/remote-deploy.sh
	grep -q 'docker cp "\$$container_id:/app/.output/public/_nuxt/."' deploy/remote-deploy.sh
	grep -q 'stat -c.*frontend_asset_parent' deploy/remote-deploy.sh
	! grep -q 'sudo' deploy/remote-deploy.sh
	grep -q 'find "\$$frontend_asset_stage" -type l -delete' deploy/remote-deploy.sh
	grep -q 'alias /var/www/yv-chat/current/' deploy/nginx/host-chat.server.conf
	grep -q 'expires 1y' deploy/nginx/host-chat.server.conf
	grep -q 'compose up -d --wait --wait-timeout 120 postgres media-init api cleanup' deploy/remote-deploy.sh
	grep -q 'compose up -d --wait --wait-timeout 120 frontend' deploy/remote-deploy.sh
	grep -q 'YV_CHAT_API_BIND_PORT:-18081' deploy/remote-deploy.sh
	grep -q 'YV_CHAT_FRONTEND_BIND_PORT:-18082' deploy/remote-deploy.sh
	grep -q 'deploy/nginx/host-chat.server.conf' .github/workflows/deploy.yml
	grep -q 'server_name chat.yoowee.ru chat.yoowee.com.de' deploy/nginx/host-chat.http.conf
	grep -q 'server_name chat.yoowee.ru;' deploy/nginx/host-chat.conf
	grep -q 'server_name chat.yoowee.com.de;' deploy/nginx/host-chat.conf
	grep -q '/live/chat.yoowee.ru/fullchain.pem' deploy/nginx/host-chat.conf
	grep -q '/live/chat.yoowee.com.de/fullchain.pem' deploy/nginx/host-chat.conf
	test "$$(grep -c 'include /etc/nginx/snippets/yv-chat-server.conf' deploy/nginx/host-chat.conf)" -eq 2
	grep -q 'Strict-Transport-Security' deploy/nginx/host-chat.server.conf
	grep -q 'Permissions-Policy "camera=(self), geolocation=(), microphone=(self)"' deploy/nginx/host-chat.server.conf
	! grep -q 'Permissions-Policy "camera=(),.*microphone=()"' deploy/nginx/host-chat.server.conf
	grep -q "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" deploy/nginx/host-chat.server.conf
	! grep -q "script-src.*'unsafe-eval'" deploy/nginx/host-chat.server.conf
	grep -q 'proxy_pass http://127.0.0.1:18081' deploy/nginx/host-chat.server.conf
	grep -q 'proxy_pass http://127.0.0.1:18082' deploy/nginx/host-chat.server.conf
	grep -q 'Connection \$$yv_chat_connection_upgrade' deploy/nginx/host-chat.server.conf
	grep -q 'limit_req_zone \$$binary_remote_addr zone=yv_chat_registration_per_ip:1m rate=10r/m' deploy/nginx/host-chat.conf
	grep -q 'location = /api/v1/auth/register' deploy/nginx/host-chat.server.conf
	grep -q 'limit_req zone=yv_chat_registration_per_ip burst=5 nodelay' deploy/nginx/host-chat.server.conf
	grep -q 'limit_req_status 429' deploy/nginx/host-chat.server.conf
	grep -q 'zone=yv_chat_pairing_per_ip:1m rate=120r/m' deploy/nginx/host-chat.conf
	grep -q 'location \^~ /api/v1/device-pairings/' deploy/nginx/host-chat.server.conf
	grep -q 'limit_req zone=yv_chat_pairing_per_ip burst=40 nodelay' deploy/nginx/host-chat.server.conf
	ssh-keygen -l -f deploy/ssh_known_hosts >/dev/null
	! grep -q 'StrictHostKeyChecking=no' .github/workflows/deploy.yml
	! grep -Eq 'docker system prune|docker compose down|--remove-orphans' deploy/remote-deploy.sh deploy/bootstrap-server.sh

docs-check:
	test "$$(grep -c '^## WP-' docs/workplan.md)" -eq 1
	grep -q 'Статус: \*\*accepted target protocol; current group deployment temporarily disabled\*\*' docs/adr/0001-e2ee-mls.md
	grep -q 'https://www.rfc-editor.org/rfc/rfc9420.html' docs/adr/0001-e2ee-mls.md
	grep -q 'https://www.rfc-editor.org/rfc/rfc9750.html' docs/adr/0001-e2ee-mls.md
	grep -q 'не шифрует сообщения и не является E2EE' README.md

ci: backend-lint backend-typecheck backend-test crypto-check frontend-lint frontend-typecheck frontend-test frontend-build compose-check deploy-check docs-check
