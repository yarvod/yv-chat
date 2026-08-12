# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-071 — Encrypted 2 GiB device media cache

Статус: **complete; local browser acceptance and full CI green**

Цель: уже загруженные group v1 изображения, видео и файлы открываются мгновенно при
возврате в чат и переживают reload/offline-период, не меняя и не подвергая риску
существующие IndexedDB message/archive/outbox/MLS stores.

### Scope

- [x] отдельная versioned БД `yv-chat-media-cache-v1`, без upgrade существующих DB;
- [x] отдельный opaque OPFS directory с IndexedDB fallback только в media DB;
- [x] AES-256-GCM chunk encryption под отдельным non-extractable per-user-device key;
- [x] exact account/device/conversation/attachment/type/size/expiry binding через AAD;
- [x] persistent LRU budget `2 GiB` на user+device и automatic expiry eviction;
- [x] bounded `128 MiB` hot RAM LRU и coalescing одинаковых concurrent downloads;
- [x] cache failure/corruption превращается в miss и не ломает authenticated download;
- [x] при unmount/logout decrypted hot blobs удаляются из application RAM;
- [x] group images/video/files используют единый cache path; direct media не включается.

### Security and data invariants

- существующие `yv-chat-messages-v1`, `yv-chat-messenger-snapshot-v1`,
  `yv-chat-message-outbox-v1`, `yv-chat-conversation-crypto-v1` и
  `yv-chat-crypto-v1` не открываются cache adapter-ом и не меняют version/schema;
- media key отдельный, non-extractable и никогда не используется для MLS/messages;
- OPFS/IDB хранит только AES-GCM ciphertext; filename и media plaintext не входят в
  operational index или logs;
- cache не даёт обойти server membership и доступен только exact local owner scope;
- cache не считается backup и может быть evicted browser/OS;
- `2 GiB` — application ceiling; меньшая browser quota или disk pressure безопасно
  отключает конкретную запись, но не messaging/crypto runtime.

### Exclusions

- direct MLS attachment encryption/upload (`BL-017`);
- pinned/never-evict media и storage settings UI;
- offline composer attachment drafts;
- Service Worker Cache API для authenticated media;
- изменение server attachment API, TTL или quota.

### Definition of Done

- A → B → A не вызывает второй HTTP download уже загруженного media;
- reload читает media из encrypted OPFS/IDB при недоступной сети;
- LRU/expiry/corruption/account-device mismatch дают bounded safe behavior;
- cache write/remove/reopen не меняет versions и содержимое existing message/MLS DB;
- после cache lifecycle сообщения расшифровываются, sealed MLS wrapping key остаётся
  non-extractable, conversation checkpoint и message stores доступны;
- frontend lint/typecheck/tests/build и полный repository CI проходят;
- реальный local Docker/browser сценарий проверяет OPFS, reload и chat switching.

### Verification evidence

- targeted cache/attachment tests: `14 passed`;
- full frontend: `44 files / 243 tests` green;
- regression создаёт encrypted message archive + sealed MLS vault + conversation
  checkpoint, заполняет/удаляет media cache, переоткрывает stores и читает исходные
  записи с неизменными DB versions;
- local Docker/browser: два реальных аккаунта, group text + PNG sync, A → B → A,
  reload после временного удаления server media bytes продолжил показывать PNG из
  persistent encrypted device cache без console errors;
- после того же reload peer отправил direct MLS v2 message, второй device успешно
  расшифровал его; existing crypto persistence продолжила работать;
- полный `make ci`: backend `241 passed / 9 skipped`, Rust `21 passed`, frontend
  `44 files / 243 tests`, lint/typecheck/build/docs/config checks green.
