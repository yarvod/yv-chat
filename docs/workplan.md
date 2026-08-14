# Текущий workplan

## WP-086 — Partial QR history sync for provably unavailable chats

Статус: **completed and production deployed** (`BUG-080`, `BL-015`, workflow
`31761641522`, image `sha-5db642f`)

Цель: один direct-чат, который server crypto state доказуемо не позволяет
синхронизировать, не блокирует объединение остальных чатов устройства.

### Production reproduction

- `admin` связывает Android и Mac с семью direct conversations;
- пять current MLS generations имеют `ready` и содержат оба device leaf;
- чаты с `test` и `test3` имеют `blocked / missing_identity`, потому что у второго
  participant нет активного MLS-capable device;
- current all-or-nothing enrollment остаётся на `5 из 7`, затем вся history job
  уходит в retry вместо завершения доступных пяти чатов.

### Scope

- оба устройства одинаково классифицируют conversation как `ready`, временно
  `pending` или доказуемо `skipped` по authoritative crypto generation;
- `missing_identity` и terminal `protocol_failure` можно пропустить; network,
  malformed response и retryable roster/key-package state нельзя молча скрывать;
- encrypted completion manifest передаёт skipped conversation IDs через любой
  доступный MLS conversation, не раскрывая их relay server-у как новое поле;
- peer ACK и local durable job различают полностью и частично успешный transfer;
- Settings показывает `синхронизировано N`, `пропущено M` и понятную причину;
- skipped chat остаётся доступен для отдельной будущей попытки после исправления
  participant crypto state.

### Security invariants

- skipped state не помечает MLS generation ready и не ослабляет protect/unprotect;
- неизвестная ошибка, invalid binding/ciphertext и authorization failure завершаются
  ошибкой или retry, а не partial success;
- manifest шифруется MLS application message в уже ready direct conversation;
- server по-прежнему не получает plaintext, local archive content или skip manifest;
- импорт и ACK остаются bound к exact pairing/device/conversation/client chunk.

### Verification

- frontend unit: 5 ready + 2 missing-identity завершаются partial success на обеих
  сторонах; unknown/pending не пропускаются; encrypted manifest и reload resumability;
- UI regression фиксирует progress/title/details для skipped chats;
- backend contract не меняется;
- full frontend lint/typecheck/tests/build;
- isolated Docker stack: fresh migrations, healthy API/frontend/PostgreSQL;
- real in-app browser against isolated Docker stack: two device-bound sessions on
  isolated `localhost` origins complete an existing-device QR flow with one `ready`
  direct and one `blocked / missing_identity` direct; both sides finish at `1 из 2`,
  report one explicit skip, expose the transferred message, and remove the stop action;
- PostgreSQL records four history chunks for the ready direct and four ACKs; browser
  consoles are clean and the pairing/history API flow completes without 5xx.

### Exclusions

- удаление production users/conversations или ручная правка их MLS generations;
- transfer media/attachments;
- новый server-readable pairing control protocol;
- изменение MLS membership policy для participant без capable device.

### Definition of Done

- 5 ready + 2 skipped дают terminal partial-success вместо `5 из 7` forever;
- оба устройства согласуют те же skipped IDs и ACK доступных чатов;
- UI честно не называет skipped chats синхронизированными;
- Docker/browser acceptance и полный frontend verification зелёные;
- docs/bugs/backlog обновлены и focused commit создан.
