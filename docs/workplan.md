# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-025 — Authorized ephemeral typing indicators

Статус: **completed**  
Backlog items: `BL-009`, `BL-011`  
Цель: показывать краткоживущий индикатор набора текста через authenticated
WebSocket, не превращая его в durable/DB truth и не позволяя клиенту объявлять
чужую identity или conversation membership.

### Результат

Активный участник отправляет bounded intent `typing(active)` по уже
аутентифицированному socket. Backend повторно проверяет user/session и active
membership, сам назначает actor и expiry, затем публикует ephemeral hint только
остальным active участникам. Frontend держит indicator в отдельном application
service, автоматически удаляет его по expiry и никогда не запускает `/sync` для
typing-only frame.

### Invariants

1. `actor_user_id` берётся только из authenticated WebSocket principal; client не
   может прислать user ID, recipient list или expiry.
2. Conversation UUID валидируется, active membership проверяется application use
   case на каждый accepted state transition; inaccessible conversation не
   раскрывается и закрывает/отклоняет frame bounded образом.
3. Typing event ephemeral: не создаёт `sync_events`, DB rows, audit payload или
   offline delivery; пропуск события безопасен.
4. Server назначает короткий bounded expiry и explicit `active`; stop/repeated
   start идемпотентны на frontend.
5. Transport принимает только exact frame shape, ограничивает частоту и число
   tracked conversation keys на connection; malformed/flood input не создаёт
   unbounded memory/DB work.
6. Payload содержит только event/conversation/actor IDs, `active` и `expires_at`;
   никаких content, draft text, ciphertext, key или credential.
7. Slow consumer остаётся изолирован bounded hub queue; publish failure не влияет
   на durable message operations.
8. Frontend parser строго различает durable и ephemeral frames. Только durable
   frame вызывает cursor catch-up; typing обновляет отдельное transient state.
9. Indicator очищается server stop, local expiry, conversation change/unmount и
   socket lifecycle; UI не утверждает, что offline user всё ещё печатает.
10. Presence и delivered-per-device остаются отдельными срезами: typing activity
    не является durable presence/last-seen сигналом.

### План

- [x] Добавить typed ephemeral realtime DTO/policy и `PublishTyping` use case.
- [x] Проверять active actor/membership через Messaging UoW и публиковать только
  другим active recipients без transaction write.
- [x] Расширить WebSocket receive loop strict frame parser, per-connection throttle
  и bounded tracked conversation state.
- [x] Расширить hub payload serializer и negative pytest: spoofed shape,
  non-member, inactive actor, expiry, recipient isolation, no durable events.
- [x] Добавить frontend strict parser, typing indicator application service с
  Scheduler-driven expiry и UI в active conversation header.
- [x] Не запускать `/sync` на typing frame; проверить reconnect/stop/unmount cleanup
  и отсутствие duplicate timers через Vitest.
- [x] Обновить architecture/backlog/bugs; full CI, container smoke, commit/push.

### Не входит в этот slice

- online/offline presence;
- delivered/read per-device receipts;
- persisted drafts;
- push notification о typing;
- rate limiting общего HTTP/API уровня.

### Проверка готовности

- user ID/expiry невозможно spoof через frame;
- non-member не может разослать typing в чужой conversation;
- start/stop доходят только active recipients и не появляются в `/sync`;
- repeated start заменяет expiry без duplicate UI rows/timers;
- expiry/stop/socket teardown очищают indicator;
- malformed/high-frequency frames bounded и не роняют другие connections;
- backend/frontend CI и local container smoke проходят.
