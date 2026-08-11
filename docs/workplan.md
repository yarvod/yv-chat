# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-027 — Durable per-device delivery state

Статус: **implemented; runtime PostgreSQL/container verification pending**  
Backlog item: `BL-009`  
Цель: хранить монотонный delivery cursor отдельно для каждого device и показывать
отправителю подтверждение доставки хотя бы на одно устройство каждого получателя.

### Invariants

1. Cursor принадлежит `(device_id, conversation_id)`; actor user/device берутся
   только из opaque session principal.
2. Device должен быть active, принадлежать actor и иметь active membership.
3. Ack разрешён только до реально полученной существующей server sequence,
   монотонен и идемпотентен; guessed future sequence отклоняется.
4. Device cursor и recipient durable `delivery_receipt` sync events коммитятся
   одной transaction; realtime остаётся post-commit best-effort.
5. Sync payload не раскрывает device ID другим participants: только actor user,
   conversation и delivered sequence.
6. Participant summary агрегирует `max(sequence)` по active devices пользователя:
   это «доставлено хотя бы на одно устройство», не «прочитано».
7. Frontend подтверждает delivery только после успешного получения и принятия
   bounded message page; read cursor остаётся отдельной foreground operation.
8. Duplicate WS/sync receipt вызывает idempotent summary reload.
9. Revoked device не может ack; его historical cursor не является active delivery
   proof после security revoke.
10. Delivery не обещает decrypt/read/persist forever и не подменяет E2EE device
    session acknowledgement, который будет согласован с protocol ADR.

### План

- [x] Domain entity, ports/UoW, SQL adapter и Alembic `0013`.
- [x] Mark/list use cases, Dishka и thin cookie/CSRF HTTP routes.
- [x] Typed `delivery_receipt` в durable sync/realtime и DB shape constraints.
- [x] Frontend DTO/gateway/use cases, auto-ack после message page и receipt merge.
- [x] Message UI status для own messages на основе participant aggregate.
- [x] Pytest/Vitest negative, retry, multi-device, revoked-device и integration tests.
- [ ] Architecture/backlog/bugs, full CI, migration rollback, container smoke,
  commit/push.

### Verification status

- Passed: backend Ruff/format/Mypy/pytest (`162 passed`, PostgreSQL cases skipped
  without `TEST_DATABASE_URL`), frontend ESLint/typecheck/Vitest (`32 passed`) and
  production build.
- Passed: Alembic full upgrade SQL generation and `0013 → 0012` downgrade SQL;
  static migration graph test prevents overlong revision IDs.
- Pending: executing upgrade/downgrade and integration suite against real PostgreSQL,
  plus rebuilt Compose health smoke. A dedicated Docker test container could not be
  started because the local Docker socket requires an execution approval that was
  unavailable; production was intentionally not used as a test database.

### Не входит в этот slice

- cryptographic protocol-level acknowledgement;
- offline local encrypted archive;
- read receipt redesign;
- delete tombstones/TTL;
- push delivery provider status.

### Проверка готовности

- foreign/revoked device и non-member не могут ack;
- lower/equal retry no-op, concurrent higher cursor wins;
- sender sees delivered only when recipient aggregate reaches message sequence;
- one recipient device ack is visible while another device remains behind;
- no plaintext/device metadata leaks in sync/API;
- fresh/rollback migration, CI/build/container smoke pass.
