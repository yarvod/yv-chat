# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-023 — Authenticated realtime notification foundation

Статус: **completed (foundation)**  
Backlog item: `BL-011` (первая вертикальная часть)  
Цель: заменить постоянный трёхсекундный foreground polling на защищённый
WebSocket wake-up channel, сохранив durable cursor sync единственным источником
истины после reconnect, sleep и пропущенных событий.

### Результат

Авторизованный PWA открывает same-origin `/api/v1/realtime` по opaque session
cookie. Backend отправляет только bounded routing hints после успешного commit;
frontend на `hello`/durable notification/reconnect запускает существующий cursor
catch-up. Редкий fallback poll остаётся страховкой от потерянного wake-up.

### Invariants

1. Credential берётся только из Secure HttpOnly cookie WebSocket handshake; query,
   subprotocol, client payload и local/IndexedDB bearer token запрещены.
2. `Origin` обязателен и должен точно совпадать с typed `allowed_origins` до
   `accept`; wildcard и отсутствующий Origin отклоняются.
3. Handshake — meaningful activity, но не вращает cookie credential через WS.
   Ping/pong и периодическая revalidation не двигают idle expiry и `last_seen_at`.
4. Established socket периодически проверяет logical `session_id`, user/device и
   expiry; revoked/blocked/expired session закрывается bounded private code.
5. WebSocket payload не содержит ciphertext, plaintext, keys, credential/hash,
   membership snapshot или произвольный server payload — только typed IDs/hints.
6. Notification публикуется только после transaction commit. Ошибка/slow client
   не откатывает сообщение и не блокирует остальных recipients.
7. In-memory registry process-local, queues bounded, cleanup выполняется в
   `finally`; Redis и horizontal-scale abstractions не добавляются.
8. `hello`, `new_message`, `conversation_updated`, `message_deleted` являются
   wake-up hints. Клиент всегда вызывает `/sync?after=<cursor>` и применяет
   idempotent authoritative events.
9. Reconnect имеет bounded exponential backoff с jitter-free deterministic
   policy для тестируемости; offline/online и visibility не создают параллельные
   sockets или polling loops.
10. `typing`, `presence`, `read_receipt` и targeted `device_revoked` добавляются
    следующими частями после их application/domain semantics (`BL-009/BL-010`),
    а не имитируются недостоверными UI-only events.

### План

- [x] Добавить application realtime DTO/ports и bounded in-memory hub adapter.
- [x] Разделить handshake activity и passive session revalidation без heartbeat
  session touch/rotation; добавить repository contract по logical session ID.
- [x] Реализовать `/api/v1/realtime`: exact Origin, cookie auth, hello,
  ping/pong, passive revocation/expiry check и deterministic close codes.
- [x] Публиковать message/conversation durable routing hints после commit, не
  меняя transaction result при отказе notifier.
- [x] Добавить frontend realtime port, strict parser, browser adapter и
  application lifecycle service с reconnect/catch-up/fallback poll.
- [x] Убрать timer ownership из `ChatWorkspace`; оставить component только
  lifecycle wiring и отображение connection state при необходимости.
- [x] Добавить pytest/Vitest negative tests: missing/wrong Origin/cookie,
  revoked session, no touch on heartbeat, bounded slow consumer, malformed
  payload, reconnect catch-up и single active connection.
- [x] Обновить architecture/backlog/bugs/config docs, прогнать full CI,
  PostgreSQL integration checks, container runtime smoke и security diff review.
- [x] Зафиксировать отдельным commit/push; BL-011 оставить `in progress`, пока
  последующие typed events не реализованы вместе с BL-009/BL-010.

### Не входит в этот slice

- presence/typing/read receipts и unread model;
- delete-for-everyone/tombstone producer;
- Web Push и Service Worker background wake-up;
- E2EE protocol, ciphertext framing changes или key persistence;
- Redis/pub-sub и multi-process delivery.

### Проверка готовности

- unauthorized/cross-origin handshake никогда не принимается;
- heartbeat не меняет session/device timestamps;
- HTTP credential rotation не превращает уже установленный socket в replay;
- message commit остаётся успешным при notifier failure;
- один slow socket не создаёт unbounded memory и удаляется;
- reconnect/hello всегда вызывает cursor catch-up, duplicate hints безопасны;
- fallback polling существенно реже текущих 3 секунд и correctness работает при
  полностью недоступном WebSocket;
- lint/typecheck/tests/build/compose config проходят.

### Проверено

- `make ci`: Ruff/format/import contracts/mypy, backend pytest, frontend
  ESLint/typecheck/Vitest/build и Compose/deploy checks прошли; backend —
  142 passed и 6 integration tests ожидаемо skipped без URL, frontend — 24 passed.
- На отдельном временном PostgreSQL 17 выполнен fresh Alembic `base → 0011` и
  затем все 6 integration tests; контейнер после проверки остановлен и удалён.
- WebSocket transport tests подтверждают 4401 без cookie, 4403 без/с чужим
  Origin, bounded malformed frame close, `hello`/pong без credential exposure и
  реальный `message commit → hub → new_message` flow без ciphertext.
- Application tests подтверждают отсутствие cookie rotation на handshake,
  отсутствие touch/commit при passive revalidation, немедленное удаление slow
  subscription и сохранение committed message при notifier failure.
- Production images пересобраны локально; PostgreSQL/API/frontend healthy,
  gateway `/api/v1/health` вернул `{"status":"ok"}`.
- Отдельный visual browser smoke не выполнялся: slice не меняет разметку или CSS;
  adapter URL/ping и lifecycle/reconnect проверены Vitest, transport — TestClient.
