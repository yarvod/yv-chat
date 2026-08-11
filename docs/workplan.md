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
   существует только в Worker/application memory и никогда не логируется/архивируется.
9. Group/provider state checkpoint атомарно sealed тем же non-extractable WebCrypto
   key. Crash/reload не откатывает epoch/ratchet и не повторяет использованный state.
10. Multi-device/reconnect correctness идёт через PostgreSQL sequence/cursor sync;
    WebSocket остаётся wake-up hint, а не единственным transport.

### План

- [ ] Зафиксировать backend conversation crypto generation/state machine и Alembic
  schema без plaintext/private fields.
- [ ] Добавить atomic bootstrap operation, required-device snapshot, KeyPackage
  claims и per-device opaque Welcome queue/ack.
- [ ] Добавить authorized opaque MLS handshake record routing и ordered sync events.
- [ ] Расширить Rust core: create group, add validated packages, accept Welcome,
  stage/validate/merge Commit, protect/unprotect application message.
- [ ] Расширить closed Worker protocol; все state-changing crypto operations должны
  checkpoint-ить sealed provider state до success наружу.
- [ ] Добавить frontend bootstrap/reconcile coordinator и typed server gateways;
  UI показывает pending/ready/blocked generation state.
- [ ] Перевести outgoing/incoming protocol v2 на MLS с exact outer AAD и удалить
  synthetic v1 для новых sends после explicit conversation cutover.
- [ ] Согласовать group rename/member add/remove и device revoke с MLS Commit;
  negative mismatch/unauthorized leaf/fork tests обязательны.
- [ ] Покрыть two-user/two-device, offline Welcome, reconnect, duplicate delivery,
  corrupted state/message, missing package и removed-device сценарии.
- [ ] Обновить ADR/architecture/backlog/bugs/README и release checklist.
- [ ] Прогнать Rust/native+WASM, backend PostgreSQL, frontend browser/storage tests,
  полный CI, commit/push, production deploy и acceptance без E2EE overclaim.

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
