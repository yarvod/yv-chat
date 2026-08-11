# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-035 — Immutable device crypto identity registry

Статус: **completed**
Backlog item: `BL-013` (server identity consistency gate)
Цель: дать каждому active authenticated device серверный immutable public anchor для
его OpenMLS identity и initial one-time KeyPackage. Registration допускается ровно
один раз и exact-idempotent retry; mismatch означает visible conflict, а не замену.
Это prerequisite для безопасного Worker provisioning/restore lifecycle.

### Security invariants

1. Endpoint всегда использует user/device из opaque session principal; client не
   выбирает владельца registration.
2. Credential identity имеет exact layout `v1 || user UUID || device UUID`; backend
   проверяет его против principal и не доверяет client fingerprint.
3. Fingerprint пересчитывается backend как SHA-256 exact protocol label + credential
   identity + Ed25519 public key.
4. Public key и KeyPackage строго bounded; base64 canonical/validated до application.
   Private keys, sealed state, message keys и plaintext никогда не принимаются.
5. Identity immutable: exact retry возвращает существующую запись, любое отличие —
   typed conflict. Revoked/wrong device не может register/read current anchor.
6. Initial KeyPackage хранится отдельно с server-derived SHA-256 reference и пока не
   выдаётся другим users; atomic claim lifecycle будет следующим slice.
7. Device row lock сериализует concurrent first registration без check-then-insert
   race; identity и KeyPackage commit одной transaction.
8. ORM не выходит из infrastructure, routes thin, dependencies через отдельный Dishka
   provider/UoW, schema change только новой Alembic migration.
9. Response/logs не содержат KeyPackage bytes, request payload или raw crypto errors.
10. Наличие registry не делает synthetic v1 E2EE и не включает auto-provision.

### План

- [x] Domain public identity/KeyPackage entities и exact protocol validation.
- [x] Focused repository/UoW ports и register/get-current use cases.
- [x] SQLAlchemy models/repositories/UoW и Alembic `0015` constraints/indexes.
- [x] Отдельный Dishka provider и composition wiring.
- [x] Thin `/api/v1/devices/current/crypto-identity` GET/PUT DTO mapping.
- [x] Domain/application/HTTP/PostgreSQL/migration/metadata security tests.
- [x] Frontend typed gateway/use cases для inspect/register, без auth auto-hook.
- [x] Architecture/backlog/bugs/workplan sync; full CI выполняется перед commit.

### Не входит в этот slice

- выдача/claim KeyPackage другим devices;
- replacement/reset identity;
- automatic Worker provision/restore при login;
- MLS conversation/group/message lifecycle;
- production E2EE claim.

### Definition of Done

- active current device может создать только свой immutable validated anchor;
- exact retry идемпотентен, mismatch/revoked/cross-device fail closed;
- database гарантирует one identity per device и unique package reference;
- frontend имеет typed API boundary, но не генерирует identity без server decision;
- migration, tests, types, lint и repository checks зелёные.

### Проверка

- backend domain/application/HTTP/metadata/migration tests: owner binding, exact retry,
  replacement conflict, CSRF/auth, response allowlist и no-private-column contracts;
- PostgreSQL integration test сериализует два concurrent exact registrations row lock и
  требует ровно одну identity + один KeyPackage (локально skip без test database,
  обязательно выполняется GitHub CI);
- `alembic upgrade head --sql` формирует fresh schema до `0015`;
- frontend gateway tests проверяют missing state, public-only PUT body, CSRF и strict
  base64/response parsing;
- backend/frontend/full repository checks выполняются перед commit.
