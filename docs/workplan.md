# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-024 — Durable read cursor и unread counters

Статус: **completed**  
Backlog item: `BL-009` (durable часть)  
Цель: хранить один authoritative read cursor пользователя на conversation,
согласовывать его между устройствами через sync/realtime и показывать корректные
unread counters без client-timestamp или локальных догадок.

### Результат

Conversation list получает bounded read-state page: `last_read_sequence`,
`latest_sequence`, `unread_count`. Пользователь может монотонно отметить
существующую server sequence прочитанной; exact retry идемпотентен, уменьшение или
прыжок за пределы существующей timeline запрещены. Все устройства пользователя и
остальные участники получают typed `read_receipt` wake-up + durable sync event.

### Invariants

1. Read cursor принадлежит `(user_id, conversation_id)`, не device: несколько
   устройств одного аккаунта видят общий server read state.
2. Только active conversation member может читать/менять своё состояние; user ID
   берётся из authenticated principal, не из body/path.
3. Cursor монотонный, `0 <= last_read_sequence <= latest existing sequence`;
   guessed future/nonexistent sequence даёт bounded validation error.
4. Upsert сериализуется row/conversation lock и защищён PK/check/FK constraints;
   retry той же/меньшей sequence не создаёт новое событие и не уменьшает cursor.
5. Unread count вычисляется server-side set-based query по существующим messages,
   без N+1 и без предположения, что sequence gaps невозможны после будущего TTL.
6. `read_receipt` payload содержит только event/user/conversation/sequence IDs,
   никогда ciphertext/plaintext/key/credential.
7. Read-state update и recipient sync events коммитятся атомарно; realtime
   notification публикуется только после commit и остаётся best-effort.
8. Reconnect/lost WebSocket применяет `read_receipt` через cursor sync;
   duplicate delivery вызывает idempotent read-state reload.
9. UI отмечает active timeline прочитанной только до фактически загруженной
   authoritative sequence; не делает read mutation из фоновой вкладки вслепую.
10. Delivered-per-device, typing expiry и presence остаются следующими срезами
    BL-009 и не подменяются этим user-level read cursor.

### План

- [x] Добавить domain `ConversationReadState`, application repository/UoW ports и
  Alembic `0012` с constraints/indexes.
- [x] Реализовать SQLAlchemy read-state adapter: monotonic upsert, batch list с
  latest/unread counts и message existence validation без N+1.
- [x] Добавить `ListConversationReadStates` и `MarkConversationRead` use cases,
  Dishka provider и thin versioned HTTP routes с CSRF/authorization mapping.
- [x] Расширить durable sync/realtime closed enums/shape constraints событием
  `read_receipt` и opaque `read_sequence` routing field.
- [x] Добавить frontend DTO/port/parser/gateway use cases и merge read state в
  messenger state/conversation sidebar.
- [x] Отмечать active conversation до последней загруженной sequence при
  foreground visibility и после timeline load, с monotonic/deduplicated submit.
- [x] Добавить pytest/Vitest negative, retry, multi-device, N+1/batch,
  reconnect/dedup и migration integration tests.
- [x] Обновить architecture/backlog/bugs/config docs; full CI, fresh migration,
  PostgreSQL integration и container runtime smoke.
- [x] Commit/push отдельным срезом; BL-009 оставить `in progress` до delivered,
  typing и presence.

### Не входит в этот slice

- per-device delivered cursor;
- typing/presence heartbeat state;
- delete tombstone и TTL gap producer;
- push unread badges/background notification UX;
- E2EE/local encrypted archive read markers.

### Проверка готовности

- non-member/foreign user cannot list or mutate read state;
- future cursor rejected, lower/equal retry no-op, concurrent higher cursor wins;
- list endpoint performs bounded set-based queries and reports actual message
  count after cursor;
- update emits one durable typed event per recipient only after commit;
- second device observes shared cursor through sync/reload;
- malformed read-state DTO/event is rejected at frontend boundary;
- missed/duplicate WS hint remains correct through `/sync`;
- migration `base → head`, rollback boundary, full CI/build/compose pass.
