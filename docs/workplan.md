# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-026 — Best-effort multi-device presence

Статус: **completed**  
Backlog items: `BL-009`, `BL-011`  
Цель: показывать online/offline состояние только как best-effort производную от
живых authenticated WebSocket connections, корректно учитывая несколько sessions
одного user и не превращая presence в durable authorization/audit truth.

### Результат

Первое активное socket-соединение пользователя создаёт online transition, последнее
закрытое — offline. Новый клиент получает authorized snapshot только пользователей,
с которыми у него есть active conversations. Transitions и snapshot содержат только
IDs/boolean, не пишутся в БД/sync и очищаются frontend при disconnect.

### Invariants

1. Presence считается на user level поверх количества live subscriptions; закрытие
   одного из нескольких devices не создаёт ложный offline.
2. Online transition только на `0 → 1`, offline только на `1 → 0`; subscribe,
   unsubscribe и snapshot выполняются под одним hub lock.
3. Snapshot/audience ограничены active conversation memberships текущего actor;
   нельзя перечислить глобально online users или подать чужой user ID.
4. Presence ephemeral: нет DB rows, sync events, push и исторического last-seen.
5. Heartbeat/revalidation/slow-consumer cleanup гарантируют eventual offline;
   presence не продлевает opaque auth session.
6. Payload содержит event/conversation/actor IDs и `online`, без IP/device/session,
   content, credential или произвольной metadata.
7. Missed transitions безопасны: каждый reconnect получает новый snapshot, а
   frontend очищает старое состояние сразу при socket disconnect.
8. Frontend не запускает `/sync` на presence frames и не использует presence как
   authorization boundary.
9. Direct/group UI показывает online только для соответствующего active member;
   собственный connection не рендерится как peer presence.
10. Реализация остаётся process-local для single backend process; horizontal scale
    потребует отдельного ADR, а не скрытого Redis dependency.

### План

- [x] Расширить RealtimeHub atomic first/last transition и authorized online query.
- [x] Добавить presence application audience/snapshot/transition use cases.
- [x] Подключить lifecycle к WebSocket subscribe/finally и отправить initial snapshot.
- [x] Добавить typed payload shape и pytest для multi-device, membership isolation,
  slow consumer, no durable writes и reconnect snapshot.
- [x] Добавить frontend parser/presence service, disconnect reset и UI indicators.
- [x] Проверить, что typing/presence не запускают durable catch-up; добавить Vitest.
- [x] Обновить architecture/backlog/bugs; full CI, container smoke, commit/push.

### Не входит в этот slice

- persisted `last_seen` social status;
- cross-process presence/Redis;
- per-device delivered receipts;
- push presence/typing;
- presence-based authorization или risk scoring.

### Проверка готовности

- два sockets одного user дают один online и offline только после второго close;
- unrelated user отсутствует в snapshot/events;
- revoked/expired/slow connection eventually исчезает;
- reconnect строит snapshot и исправляет пропущенные transitions;
- no DB/sync mutations;
- backend/frontend CI и local container smoke проходят.
