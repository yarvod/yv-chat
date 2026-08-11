# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-050 — Conversation-scoped direct/group protocol policy

Статус: **in progress**
Backlog: `BL-050`

Цель: стабилизировать messaging после MLS rollout, оставив OpenMLS v2 обязательным
для direct conversations и временно вернув group conversations на честно
обозначенный synthetic v1 без E2EE. Исключить silent downgrade, сохранить чтение
истории по protocol version каждой записи и не запускать group MLS reconciliation.

### Scope и security contract

- [x] Backend принимает новые direct messages только с `protocol_version=2` и
  валидной current READY generation/epoch/roster binding.
- [x] Backend принимает новые group messages только с `protocol_version=1` без
  crypto generation/epoch и отклоняет group v2.
- [x] Exact retry уже сохранённого historical direct v1 остаётся идемпотентным;
  новые direct v1 запрещены.
- [x] Frontend выбирает outgoing protocol только по authoritative conversation type:
  direct → v2, group → v1; fallback после crypto error отсутствует.
- [x] Group UI постоянно и недвусмысленно сообщает, что сообщения не защищены E2EE
  и доступны серверу; direct UI сохраняет fail-closed MLS состояния.
- [x] Group open/send/sync не вызывает bootstrap/Welcome/Commit reconciliation;
  direct flow и device enrollment остаются без ослабления.
- [x] Исторические v1/v2 rows не мигрируются и читаются exact-version adapter;
  неизвестная версия остаётся fail closed.
- [x] README, architecture, ADR и backlog отражают временную type-level policy и
  отдельный будущий возврат group MLS.

### Tests и acceptance

- [x] Backend unit/integration/negative tests: direct v1 reject, valid direct v2,
  group v1 accept, group v2 reject, non-member reject и historical retry.
- [x] Frontend tests: protocol selection, group warning/send availability,
  отсутствие group reconciliation, direct fail-closed и mixed-version history.
- [x] Полный `make ci`, migration/config checks и secret/diff review.
- [x] Production-like browser: два аккаунта/устройства обмениваются direct v2 и
  group v1 сообщениями, reload/catch-up сохраняет чтение, network contract не имеет
  group crypto bootstrap и отправляет ожидаемые protocol versions.
- [x] Revoke/relogin acceptance: новый device читает доступную group v1 history,
  direct future v2 работает после enrollment, а недоступная старая MLS history не
  подменяется plaintext fallback.
- [ ] Commit/push, immutable deploy и production health/log verification.

### Acceptance evidence

- fresh PostgreSQL `messenger_test` прошёл migrations `0001 → 0018` и все 8
  integration tests;
- browser origins `localhost`, `127.0.0.1` и `alice.localhost` моделировали Bob и
  два последовательных Alice devices без общего cookie/IndexedDB scope;
- два account devices обменялись direct v2 и group v1 в обе стороны, reload обоих
  сохранил историю; browser console errors/warnings отсутствовали;
- новый/relogin device сразу прочитал group v1 history, показал старые direct epochs
  unavailable и после roster update расшифровал future direct v2;
- revoke перевёл target device на `/login`; повторный login создал новый leaf без
  доступа к старым epochs и без fallback;
- DB aggregate после acceptance: `direct/v2=3`, `group/v1=2`; direct generations=4,
  group generations=0; backend logs без HTTP 5xx/traceback/constraint errors;
- acceptance обнаружил `BUG-050` stale direct badge; regression добавлен, после
  rebuild сообщение decrypted и warning исчез на recipient/reload.

### Исключения

- attachments/photo/file upload — следующий отдельный `BL-043` workplan сразу после
  этого релиза; group media не будет ложно называться encrypted;
- migration/re-encryption уже сохранённых messages;
- изменение MLS primitives, wire format или private state;
- secure group E2EE: возвращается отдельным future hardening после multi-device
  stabilization и реального browser matrix.

### Definition of Done

- conversation type и protocol version невозможно смешать для нового сообщения;
- direct chat никогда не понижается до v1 при ошибке OpenMLS;
- group chat остаётся usable на нескольких клиентах и честно маркирован non-E2EE;
- mixed historical rows переживают sync/reload без изменения server content;
- реальные сценарии подтверждены тестами и production-like браузером;
- после зелёного production deploy active workplan переключён на фото/файлы.
