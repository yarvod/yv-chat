# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-014 — Durable cursor sync и offline catch-up

Статус: **completed**
Backlog item: `BL-008`
Цель: сделать PostgreSQL event stream источником восстановления после сна, reconnect и полностью пропущенного realtime.

### Результат

У каждого пользователя есть monotonic stream cursor. Message и соответствующие recipient events записываются атомарно; conversation/membership changes создают routing events для затронутых пользователей. `/api/v1/sync?after=` отдаёт bounded page, `next_cursor`, `has_more` и retention-gap signal.

### Invariants

1. Cursor монотонен и уникален в stream конкретного пользователя.
2. Event visibility фиксируется recipient row в момент операции, а не вычисляется по текущему membership задним числом.
3. Message row и `message_created` events находятся в одной transaction.
4. Exact message retry не создаёт duplicate event.
5. Conversation create/update/member removal создаёт idempotently applicable event с opaque IDs.
6. Removed member получает событие, позволяющее удалить inaccessible conversation локально.
7. Sync payload не содержит ciphertext/plaintext/keys; content загружается через authorized resource API.
8. Pagination строго cursor-ascending и bounded; duplicate application безопасна по stable event ID/cursor.
9. Retention cleanup idempotent; слишком старый cursor получает explicit reset/gap signal.
10. WebSocket не участвует в correctness tests.

### План

- [x] Добавить typed pending/persisted sync event records и policy.
- [x] Добавить SyncRepository/Messaging/Conversation UoW ports.
- [x] Добавить `sync_streams`/`sync_events` models и Alembic `0010`.
- [x] Реализовать atomic per-user cursor allocation и retention-aware list.
- [x] Emit message events для всех active recipients без duplicate retry.
- [x] Emit conversation/membership events, включая removed member.
- [x] Добавить ListSyncEvents use case и `/api/v1/sync` DTO.
- [x] Добавить unit/HTTP/PostgreSQL offline catch-up/gap/concurrency tests.
- [x] Проверить migration/full CI/Docker, обновить docs и создать commit.

### Не входит в scope

- WebSocket/presence/typing/receipts;
- message deletion/tombstone producer (event type резервируется для `BL-010`);
- frontend IndexedDB apply engine;
- E2EE.

### Проверка готовности

- при полностью выключенном WebSocket message/conversation events восстанавливаются через sync;
- retry не удваивает message event;
- removed member получает update, но больше не читает conversation;
- stale cursor явно сигнализирует gap;
- проверки зелёные и отдельный commit создан.
