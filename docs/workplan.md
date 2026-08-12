# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-064 — Native-feeling mobile conversation continuity

Статус: **implemented locally; installed-Pixel acceptance pending**

Цель: установленная mobile PWA открывает push ровно в нужном диалоге и у нужного
сообщения, сохраняет осмысленную позицию каждого диалога и удерживает composer в
видимой области при появлении клавиатуры без скачков ленты или чёрных Android
system bars.

### Reproduction

- push payload содержит `conversation_id` и `message_id`, но service worker сохраняет
  в notification data только conversation и строит маршрут без message target;
- уже открытый PWA client получает `navigate()`, однако mounted chat workspace не
  реагирует на последующее изменение query;
- `MessagePanel` безусловно вызывает `scrollToLatest()` при mount и смене диалога,
  поэтому локальная позиция никогда не восстанавливается;
- dynamic viewport/keyboard resize не имеет единого shell height source, и browser
  focus scrolling может вынести composer за видимую область;
- конфликтующие static/dynamic `theme-color` и искусственный safe-area fallback
  оставляют Pixel status/navigation surfaces чёрными вместо цвета app chrome.

### Scope

- [x] сохранить validated message ID в notification data и строить scoped
  conversation+message deep link для existing/cold PWA client;
- [x] реактивно применять route target после cold start и `WindowClient.navigate()`;
- [x] загружать bounded history window, содержащий target/сохранённый anchor;
- [x] хранить encrypted per-conversation anchor в существующем local snapshot:
  message ID, server sequence, относительный offset и latest state;
- [x] throttled сохранять viewport, восстанавливать после DOM/layout changes и не
  перетирать его incoming message/autoscroll policy;
- [x] использовать visual viewport height для mobile shell и сохранять bottom
  intent при открытии/закрытии клавиатуры;
- [x] унифицировать PWA manifest/meta/runtime theme color и safe-area surface;
- [x] покрыть worker, route, encrypted snapshot, timeline и mobile CSS regressions.

### Local acceptance evidence

- frontend `218` tests, ESLint, Nuxt typecheck и production PWA build green;
- полный `make ci`: backend `238 passed, 9 skipped`, Rust `21 passed`, frontend
  `218 passed`; Ruff/format/import-linter/mypy/clippy/build/config/docs contracts green;
- browser acceptance на mobile viewport `412×915`: CSS app height совпадает с
  `visualViewport`, root не получает лишний scroll, runtime console без warnings/errors;
- runtime light theme перепроверен: все manifest/head-controlled system-bar meta
  синхронно получают `#ffffff`; dark contract покрыт `#151721` regression test;
- authenticated installed-Pixel push click, keyboard и gesture-bar acceptance требует
  rollout свежего service worker/manifest и повторной проверки на устройстве.

### Security invariants

- notification остаётся generic и не содержит sender/plaintext/ciphertext;
- route принимает только bounded identifiers и не становится authorization boundary;
- server membership/access checks остаются authoritative для target message;
- viewport anchor хранится внутри AES-GCM encrypted device-local snapshot;
- никакие decrypted message body или crypto keys не попадают в route/storage/logs.

### Exclusions

- native Android/iOS wrapper;
- remote history старше server TTL и local encrypted archive retention;
- изменение read-receipt semantics;
- push preview с именем или текстом сообщения;
- полный редизайн списка чатов по образцу Telegram.

### Definition of Done

- notification click открывает exact conversation/message при cold и warm PWA;
- возврат в каждый диалог восстанавливает stable message-relative anchor;
- новые сообщения не дёргают читающего историю пользователя, а явный переход вниз
  возвращает latest policy;
- composer остаётся доступным при Android/iOS visual viewport resize;
- Pixel system bars используют согласованный app chrome color без layout gap;
- frontend lint, typecheck, tests и build проходят; mobile browser acceptance записан.
