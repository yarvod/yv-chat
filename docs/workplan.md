# Текущий workplan

## WP-126 — Кто поставил реакцию в message context menu

Статус: **locally verified; ready for production rollout**
Backlog: `BL-077`

Цель: в long-press/right-click меню сообщения показывать Telegram-подобный
вертикальный список участников и поставленных ими реакций для group и direct
conversation, не перегружая timeline и не ломая mobile viewport.

### Scope

- authorized reaction summary transport дополнительно возвращает bounded ordered
  reactor user IDs для каждой emoji aggregate;
- frontend сопоставляет IDs с уже authorized conversation members и не делает
  отдельного directory/profile запроса;
- внизу context menu показывается compact section «Реакции»: emoji, display name,
  username и avatar initial для каждой пары actor/reaction;
- section отсутствует у сообщений без реакций;
- длинный список имеет bounded height, настоящий vertical scroll и удерживается
  внутри viewport на mobile/desktop;
- текущие quick/all reaction palette, toggle, haptics, reply/pin/copy/delete/select и
  long-press/right-click/keyboard entry points сохраняются.

### Security and data invariants

- list endpoint по-прежнему требует authenticated active actor и membership exact
  conversation;
- server не возвращает global directory и не раскрывает реакции outsider-у;
- actor IDs берутся только из persisted reactions от messages exact conversation;
- UI использует только metadata, уже доступную участнику conversation; message
  plaintext/direct MLS content не участвует в запросе;
- durable sync/realtime event shape и reaction mutation semantics не меняются.

### Tests

- backend application: actor IDs сохраняют deterministic order, count совпадает с
  длиной списка, group/direct membership проходит, outsider/foreign остаются denied;
- HTTP/parser: bounded actor IDs сериализуются/валидируются, malformed/duplicate IDs
  отвергаются;
- component: footer показывает exact emoji/name/username, скрыт без reactions и имеет
  несколько actor/reaction rows;
- component: existing quick toggle и expanded 48-emoji palette не регрессируют;
- frontend Vitest, ESLint, Nuxt typecheck и production/PWA build;
- responsive browser QA desktop и mobile, включая overflowing actor list;
- backend Ruff/import boundaries/mypy/pytest и production config/deploy checks.

### Exclusions

- profile photos/avatar upload;
- отдельное modal reaction analytics/history;
- reaction timestamps и push notification content;
- изменение allowed palette или количества реакций пользователя;
- изменение E2EE/message payload.

### Definition of Done

- long-press на reacted message показывает каждого reactor-а и его exact emoji внизу
  меню как в reference interaction;
- список работает одинаково в direct/group, scroll-ится без horizontal overflow и
  не уводит actions за пределы mobile viewport;
- authorization и parser regressions проходят;
- docs/checks обновлены, изменения готовы к focused commit и production rollout.

### Acceptance

- backend Ruff format/lint, import boundaries, mypy и полный pytest зелёные:
  `294 passed`, `12 skipped`;
- frontend ESLint, Nuxt typecheck, полный Vitest и production/PWA build зелёные;
- Docker Compose, deploy scripts и docs-check зелёные;
- responsive browser QA: desktop `1280×720` и mobile `390×844`, 12 actor rows,
  actor list `176px` при `scrollHeight=622px`, scroll достигает последней строки,
  horizontal overflow отсутствует и menu остаётся внутри viewport;
- локальный crypto-check не повторён: `cargo` отсутствует в текущем PATH; crypto
  source/package не менялись, production workflow повторит pinned crypto suite.
