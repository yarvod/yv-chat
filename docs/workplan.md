# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-079 — Durable QR device pairing and passwordless session bootstrap

Статус: **implemented and locally verified; production rollout held for `WP-080`**
(`BL-015`, ADR-0003)

Цель первого QR-slice: компьютер всегда показывает QR, телефон всегда сканирует,
а уже доверенное устройство явно подтверждает новый browser install. Новый install
получает отдельные `Device` и opaque HttpOnly session без передачи пароля, cookie,
MLS signer, storage key или чужой device identity. Pairing переживает restart API и
не требует online собеседника или открытия чата.

### Scope

- принять ADR/threat model для двух ролей:
  `enrollment_request` (новый компьютер показывает QR доверенному телефону) и
  `enrollment_offer` (доверенный компьютер показывает QR новому телефону);
- добавить PostgreSQL-backed одноразовую state machine
  `created → confirmation_pending → approved → authorized` с terminal
  `cancelled/expired`, configurable TTL и monotonic/idempotent transitions;
- разделить QR scan token и candidate proof: QR не даёт права получить session, а
  candidate должен доказать владение локальным 256-bit secret, чей SHA-256 commitment
  был привязан до approval;
- exact trusted session/device сканирует request или создаёт offer и только он может
  approve/cancel; cross-account и revoked-session операции fail closed;
- после approval candidate atomically создаёт собственные `Device` + `Session` и
  получает обычные `__Host-` session/CSRF cookies; lost HTTP response допускает
  bounded idempotent authorize retry с тем же candidate proof;
- добавить versioned `/api/v1/device-pairings` transport, runtime validation и UI:
  QR на login/settings, in-app camera scanner и paste fallback на телефоне, одинаковый short
  authentication code на обоих экранах, progress/cancel/error states;
- не менять MLS group membership, не копировать local history и не выдавать готовность
  E2EE в этом slice: это следующие `BL-015` workplans после безопасного pairing base.

### Security invariants

- QR/URL не содержит password, session credential, candidate proof, MLS/private key,
  archive/storage key или plaintext;
- backend хранит только SHA-256 digests scan/proof tokens; candidate proof существует
  в browser memory/session storage только до exchange на HttpOnly session cookie;
- scan/manual code сами не создают session/device; требуется explicit approval exact
  active trusted device и candidate preimage proof;
- state-changing authenticated endpoints сохраняют strict Origin + CSRF; anonymous
  pairing endpoints требуют strict Origin, bounded payloads/TTL и не раскрывают
  account/session data без candidate proof;
- logs/errors не содержат QR token, proof, authentication code или issued session;
- restart/retry не создаёт второй device/session и не позволяет повторно использовать
  pairing для другого browser/account.

### Verification

- domain/application tests: both roles, wrong proof, wrong approver/account, expiry,
  cancel, replay, concurrent/double approve and idempotent authorize;
- HTTP tests: Origin/CSRF/cookie flags, anonymous vs authenticated boundary, bounded
  response disclosure and no session before approval;
- migration tests: fresh database → head и upgrade from `0023`;
- PostgreSQL integration regression пересоздаёт engine/session factory между
  `created`, `confirmation_pending/approved` и `authorized`, затем проверяет
  idempotent authorize и отсутствие duplicate device/session;
- frontend tests: QR payload validation, request/offer UI, code comparison, scanner
  denial/paste fallback and authorize retry after transient network failure;
- backend Ruff/format/mypy/pytest, frontend lint/typecheck/test/build, Compose config
  and full CI pass before rollout.

### Exclusions / next slices

- background pending-device MLS enrollment во все direct (`WP-080`);
- authenticated bidirectional history manifests/chunks/merge (`WP-081`);
- media archive transfer и External Commit recovery;
- Safari ↔ installed PWA private-state merging without explicit pairing.

### Definition of Done

- оба направления pairing создают отдельную revocable device-bound session только
  после mutual confirmation и candidate proof;
- компьютер нигде не использует камеру; iOS scanner принадлежит установленной PWA;
- API/PostgreSQL restart на каждом durable state продолжает flow без password relogin;
- existing devices/MLS chats не меняются до следующего atomic enrollment slice;
- focused commit, migration/security review, CI/CD и production-like restart checks
  завершены.

### Verification result

- backend Ruff/format/mypy и `259 passed, 11 skipped` прошли локально;
- отдельный PostgreSQL integration test после fresh `alembic upgrade head` прошёл,
  включая три независимых engine lifecycle и повтор `authorize`;
- frontend lint/typecheck, `281 passed` и production build прошли;
- Compose/deploy config checks и `git diff --check` прошли;
- production deploy намеренно отложен: до `WP-080` пользовательский QR login не должен
  обещать автоматическую MLS-готовность всех личных чатов.
