# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-047 — MLS v2 conversation lifecycle и E2EE сообщений

Статус: **in progress**
Backlog: `BL-014`
Цель: заменить synthetic v1 для новых сообщений на реальный MLS 1.0 lifecycle,
где каждый device — отдельный leaf, server маршрутизирует только opaque records,
а send блокируется при несогласованной crypto membership.

### Почему это блокирует фотографии и файлы

Attachment может быть зашифрован случайным file key до upload, но этот key и
encrypted metadata должны доставляться получателям внутри E2EE message. Текущий
synthetic v1 payload виден серверу; положить туда file key означало бы лишь
имитировать encrypted attachment. Поэтому `BL-016/017/043` переходят в `WP-048`
сразу после реального MLS v2 path.

### Инварианты

1. Используется только MLS 1.0 и pinned OpenMLS ciphersuite из ADR-0001. Никаких
   собственных ratchet/KDF/key agreement и silent fallback v2→v1.
2. Один backend Device соответствует одному canonical BasicCredential/MLS leaf;
   одна Conversation — одной deterministic group generation.
3. Bootstrap claim-ит по одному validated one-time KeyPackage для каждого required
   active device. Нехватка хотя бы одного package оставляет conversation
   `pending-crypto`; partial group не считается secure и send заблокирован.
4. Server хранит только public credentials, KeyPackages, opaque Welcome/Commit/
   PrivateMessage bytes, routing IDs, generation/epoch hints и timestamps. Private
   signer/init/group/application secrets и plaintext не выходят из Worker/vault.
5. Welcome — адресная per-device очередь с TTL, idempotent delivery/ack и exact
   conversation/generation binding; это не broadcast message history.
6. Membership mutation считается crypto-complete только после authorized MLS Commit.
   Removed device немедленно теряет server access, а future send блокируется до
   успешной epoch reconciliation.
7. Application message AAD exact: label + conversation UUID + client message UUID.
   После decrypt AAD сравнивается с outer server routing; mismatch fail closed.
8. MLS plaintext — closed bounded DTO (`text` сначала, attachment variant в WP-048),
   существует только в Worker/application memory либо в AES-GCM encrypted
   device-local content cache и никогда не логируется/хранится сервером открыто.
9. Group/provider state checkpoint атомарно sealed тем же non-extractable WebCrypto
   key. Crash/reload не откатывает epoch/ratchet и не повторяет использованный state.
10. Multi-device/reconnect correctness идёт через PostgreSQL sequence/cursor sync;
    WebSocket остаётся wake-up hint, а не единственным transport.

### План

- [x] Зафиксировать backend conversation crypto generation/state machine и Alembic
  schema без plaintext/private fields.
- [x] Добавить atomic bootstrap operation, required-device snapshot, KeyPackage
  claims и per-device opaque Welcome queue/ack.
- [x] Добавить authorized ordered MLS update routing: device получает только ready
  generations, в roster которых он состоял, после явного generation cursor;
  durable `conversation_updated` будит clients при membership/device revoke/logout.
- [x] Расширить native Rust core: deterministic create group, add validated
  packages + merge, accept Welcome с exact group/suite/tree binding и
  protect/unprotect application message с outer AAD.
- [x] Экспортировать initial create/add/Welcome и protect/unprotect через безопасные
  WASM bindings поверх проверенного native контракта.
- [x] Обработать Commit существующим members, ordered catch-up нескольких generation
  и explicit same-device rejoin после remove/re-add; native/release-WASM тест
  доказывает add/remove, запрет future decrypt удалённому leaf и восстановление.
- [x] Расширить closed Worker protocol; все state-changing crypto operations должны
  checkpoint-ить sealed provider state до success наружу.
- [x] Добавить frontend bootstrap/reconcile coordinator, typed server gateway и
  encrypted crash-safe local checkpoint для finalize/Welcome ack.
- [x] Показывать per-conversation checking/pending/ready/blocked state; E2EE label
  появляется только после ready, missing identity/KeyPackage объясняется отдельно.
- [x] Перевести outgoing/incoming protocol v2 на MLS с exact outer AAD без silent
  fallback; synthetic v1 оставлен только read-only для исторических сообщений.
- [x] Привязать каждый v2 transport envelope/outbox/DB row к exact server
  `crypto_generation_id + crypto_epoch`: старый epoch и подменённый generation
  отклоняются, а exact idempotent retry уже принятого сообщения переживает rotation.
- [x] Сохранить replay protection: plaintext content cache и sealed receive/sender
  ratchet обновляются одной IndexedDB transaction под non-extractable device key.
- [x] Добавить bounded KeyPackage generation/replenishment до production cutover;
  foreground target — восемь уникальных one-time packages из sealed provider,
  refresh выполняется при initialization и перед новой conversation reconciliation.
- [x] Согласовать group member add/remove и explicit device revoke/logout с MLS
  Commit: durable sync invalidates clients, а backend блокирует send при любом
  расхождении actual active-device roster с current MLS snapshot. Rename epoch не меняет.
- [x] Покрыть two-user/two-device, offline Welcome, reconnect, duplicate delivery,
  corrupted state/message, missing package и removed-device сценарии.
- [x] Обновить ADR/architecture/backlog/bugs/README и release checklist.
- [ ] Прогнать Rust/native+WASM, backend PostgreSQL, frontend browser/storage tests,
  полный CI, commit/push, production deploy и acceptance без E2EE overclaim.

Текущий инкремент: полный локальный CI зелёный (210 backend tests, 20 Rust tests,
159 frontend tests с regression BUG-047, native+release WASM build, PWA
precache/build, compose/deploy/docs checks). Fresh PostgreSQL прошёл migrations
`base → 0018` и integration suite. Финальный log/security review не нашёл plaintext,
credentials или private MLS state. Production-like browser acceptance на двух
чистых origin/device подтвердил provisioning, KeyPackage pool, двусторонний MLS v2
exchange и reload decrypt; найденный lifecycle race `BUG-047` исправлен и повторно
проверен. Остались commit/push и production deploy + acceptance без E2EE overclaim.

### Definition of Done

- сервер/DB/logs не получают message/attachment plaintext или private key material;
- два пользователя и несколько их devices создают одну generation и обмениваются
  MLS PrivateMessage после Welcome/Commit/cursor catch-up;
- missing/stale/substituted KeyPackage, invalid Welcome/Commit/AAD, storage rollback
  и membership mismatch блокируют send/decrypt без fallback;
- removed/revoked leaf не получает future epoch, а остальные clients сходятся после
  offline/reconnect;
- UI показывает E2EE только для реально ready v2 conversation и отдельно маркирует
  исторические v1 сообщения как незащищённые;
- полный CI и production smoke проходят до начала `WP-048` attachments.

Следующий `WP-048` обязан включать: multi-file message DTO, несколько фотографий в
одной gallery с viewer/swipe, caption, download, picker/paste/desktop drag-and-drop,
encrypted offline draft/outbox, server/local storage usage UI, per-device cache
controls и сохранение per-conversation scroll anchor. `Web Push`/notification
preferences остаются отдельным следующим vertical slice и не передают plaintext.
