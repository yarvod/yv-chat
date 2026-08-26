# Текущий workplan

## WP-134 — Monotonic retention merge for local and QR history

Статус: **implemented and locally verified; production rollout pending**
Backlog: `BL-FIX-063`

Цель: одна и та же immutable message envelope должна безопасно объединяться между
server reconciliation, старым IndexedDB archive и QR peer даже тогда, когда
production retention продлила `expires_at`. Такой metadata drift не должен закрывать
локальный архив, повторно грузить чужие сообщения из API или обрывать QR transfer до
первого ACK.

### Production root cause

- свежая физическая попытка `659c29df…` сохранила `22` chunks в обоих направлениях
  (`11 + 11`) для одинаковых пяти conversations, но получила `0` ACK; две следующие
  попытки также остановились на первом chunk;
- upload, QR authorization и server relay поэтому работали; исключение возникало на
  client import до `ackHistoryChunk`;
- IndexedDB считал `expires_at` частью immutable identity. ADR-0006 продлил уже
  существующие server rows, поэтому старый local row и authoritative/peer row имели
  одинаковые ID, sequence, sender, protocol, ciphertext и `created_at`, но разный TTL;
- archive переводил это в `corrupt`, закрывался, а последующие запуски снова получали
  сообщения из API. Это объясняет одновременно QR `ACK=0` и постоянное
  «Локальная история недоступна» на Pixel для части входящих сообщений.

### Scope

- исключить mutable retention projection из immutable envelope identity;
- принимать только монотонное объединение TTL через более поздний `expires_at`, не
  разрешая stale peer/server copy сократить срок уже сохранённой записи;
- сравнивать `created_at` как один timestamp, а не как строковое оформление UTC;
- сохранить существующий local plaintext projection и прежний fail-closed contract
  при несовпадении ciphertext или immutable routing metadata;
- проверить реальный двухбраузерный QR flow на Docker/Nginx со специально созданным
  old-vs-extended TTL drift и холодным повторным открытием обоих origins.

### Tests and result

- IndexedDB regression объединяет старый local TTL с продлённым authoritative TTL,
  сохраняет local plaintext и не допускает последующей регрессии expiry;
- real encrypted two-peer regression использует две отдельные `IDBFactory`, полный
  symmetric MLS relay union и требует ACK всех четырёх chunks;
- Docker Browser QA создал direct chat и 30 сообщений, загрузил старую expiry copy на
  первом устройстве, продлённую — на втором, снял настоящий QR как image, декодировал
  его тем же `qr-scanner` worker и сверил одинаковый SAS `975984`;
- UI завершил обе стороны: `30` доступно, `30` получено, `1/1` chat; relay DB содержит
  `4/4` ACK;
- после закрытия и нового открытия обеих browser tabs каждый origin показал все `30`
  сообщений, последнее сообщение и ни одного предупреждения о локальной истории;
  browser console logs пусты.

### Definition of Done

- frontend unit suite, lint, typecheck и production/PWA build проходят в Docker;
- Compose config валиден, diff не содержит secrets или test-only production surface;
- production rollout использует exact immutable commit SHA и проходит health/runtime
  verification;
- следующая физическая попытка пользователя ACK-ит первый и последующие chunks без
  повторного бесконечного export loop.
