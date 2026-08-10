# Backlog

Упорядоченный backlog продукта. В работу одновременно берётся одна фича: её подробный план переносится в `workplan.md`, реализация и документация завершаются одним сфокусированным коммитом.

## In progress

### BL-002 — User repositories и admin-controlled activation

Repository ports/adapters, admin-only invitation, одноразовый hashed activation secret и Argon2id password activation. Подробности: `docs/workplan.md`.

## Next

### BL-003 — Opaque sessions и active devices

- login/logout через `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` cookie;
- хранение только session credential hash;
- device-bound sessions, idle/absolute expiry и throttled touch;
- atomic credential rotation с previous-token grace period;
- replay handling и security events;
- list/rename/revoke device, revoke all other sessions;
- CSRF/Origin и trusted-proxy client IP handling.

### BL-004 — Conversations и membership authorization

- direct/group conversations;
- member roles и lifecycle;
- create/list conversation use cases;
- серверная проверка membership на каждой операции;
- negative tests для non-member и privilege escalation.

### BL-005 — Reliable ciphertext messaging

- synthetic opaque ciphertext transport, явно не обозначаемый как E2EE;
- server sequence/cursor ordering;
- idempotent message creation по client request ID;
- pagination, receipts и sync events;
- reconnect/offline catch-up tests;
- tombstone model для delete-for-everyone.

### BL-006 — Realtime notifications

- authenticated same-origin WebSocket с Origin validation;
- явные малые event types;
- in-memory connection tracking для одного backend process;
- heartbeat timeout без продления auth session;
- восстановление через cursor sync после пропущенных событий.

### BL-007 — E2EE design review

- выбрать зрелый browser-compatible протокол, приоритетно исследовать MLS/OpenMLS + WASM;
- документировать device identity, group membership, rotation и persistence;
- определить protocol framing/versioning и test vectors;
- провести отдельный security review до реализации.

### BL-008 — E2EE implementation

- изолированный frontend crypto adapter;
- device crypto identity и protocol state;
- encrypt/decrypt intent-level API;
- membership changes и key rotation;
- удалить synthetic transport shortcuts;
- backend никогда не получает plaintext или private keys.

### BL-009 — Encrypted attachments и media lifecycle

- client-side encryption до upload;
- `MediaStorage` port и `LocalMediaStorage` в `/data/media`;
- opaque storage keys, streaming I/O, size/quota/access checks;
- encrypted download и client-side decrypt;
- TTL cleanup, безопасный retry и missing-file tolerance.

### BL-010 — Offline PWA storage и outbox

- IndexedDB repositories для encrypted history, indexes, sync state и outbox;
- device-local storage key;
- bounded encrypted media cache через OPFS где доступно;
- retry/idempotency и conflict handling;
- PWA update/schema compatibility.

### BL-011 — Web Push

- VAPID configuration без committed secrets;
- subscriptions на device/install;
- opaque routing-only payload;
- invalid subscription cleanup;
- deduplication WebSocket + Push + sync.

## Later

### BL-012 — Production ingress и delivery

- production Docker images и Compose;
- Nginx HTTPS/WebSocket proxy/security headers;
- GHCR build workflow и protected deployment;
- intentional migration step, healthcheck и rollback plan;
- VPS resource/disk monitoring.

### BL-013 — Backup, restore и retention operations

- encrypted offsite PostgreSQL backups;
- bounded backup retention compatible with message TTL;
- explicit media durability policy;
- restore test and operational runbook;
- cleanup metrics and disk alerts.

### BL-014 — Voice/video calls

- только после стабильных messaging, sync и E2EE;
- FastAPI signaling events;
- WebRTC media plane;
- STUN/TURN with coturn fallback;
- call state machine и failure/reconnect UX.

## Completed

### BL-001 — Persistence foundation

SQLAlchemy async + asyncpg, Alembic, отдельные domain/ORM модели `User`/`Device`, typed database settings, первая migration и PostgreSQL upgrade/downgrade verification.

### BL-000 — Repository bootstrap

FastAPI healthcheck, Nuxt PWA shell, lint/typecheck/tests/build, `uv`/npm lockfiles, Compose, Nginx local config, Makefile и GitHub Actions CI.
