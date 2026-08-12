# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-066 — Instant cached conversation return

Статус: **implemented and verified locally**

Цель: уже открытый conversation при переключении A → B → A появляется немедленно из
bounded app-memory cache, сохраняет точный viewport anchor и только затем незаметно
догоняет server; cold anchor сначала рисуется из encrypted IndexedDB.

### Reproduction

- `selectConversation()` очищал reactive timeline перед каждым чтением IndexedDB и
  server catch-up, поэтому возврат в уже открытый чат показывал пустой UI;
- anchor-window загружался network-first, хотя нужные ciphertext уже лежали локально;
- debounced scroll save вычислял anchor после смены active conversation и терял
  позицию предыдущего чата при быстром переключении.

### Scope

- [x] хранить последние reactive history windows для 12 conversations в bounded LRU;
- [x] рисовать hot window синхронно и выполнять forward catch-up в фоне;
- [x] для cold saved anchor сначала отдавать encrypted IndexedDB page, затем server;
- [x] не применять поздний результат к уже неактивному conversation;
- [x] захватывать viewport anchor в момент scroll и flush-ить его до смены chat;
- [x] обновлять inactive hot window при tombstone и очищать удалённые conversations;
- [x] покрыть delayed network, повторный switch и debounce race regressions.

### Security invariants

- decrypted `TimelineMessage` живёт только в bounded RAM текущего app instance;
- IndexedDB по-прежнему хранит только encrypted transport envelopes;
- cache не подменяет cursor sync и не становится источником authoritative ordering;
- stale async result не может перерисовать другой активный conversation.

### Exclusions

- persistent decrypted archive или `localStorage` message cache;
- OPFS media cache, draft persistence и attachment eviction/pinning;
- изменение server history/cursor/retention protocol;
- сохранение component instance для каждого когда-либо открытого chat.

### Definition of Done

- A → B → A возвращает все уже отрисованные сообщения без blank/loading flash;
- сохранённый message-relative anchor восстанавливает то же сообщение и offset;
- IndexedDB anchor page появляется до задержанного network reconciliation;
- frontend lint, typecheck, tests и production build проходят;
- реальный локальный browser acceptance подтверждает hot paint и stable viewport.

### Verification evidence

- frontend `42` files / `224` tests, ESLint, Nuxt typecheck и production PWA build: green;
- isolated Docker stack `localhost:18091`, fresh PostgreSQL migrations и два browser
  origins/devices: 45-message history + 5-message switch target;
- hot return painted all 45 messages in `47 ms`; anchor sequence `16` restored in
  `625 ms`, сохранил тот же message ID и offset в пределах `14 px`;
- после `800 ms` background reconciliation count/anchor не изменились; browser
  console warnings/errors: `0`.
