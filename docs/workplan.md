# Текущий workplan

## WP-123 — Профиль переписки и общая медиатека

Статус: **implemented and verified locally**
Backlog: `BL-083`

Цель: по нажатию на имя/аватар в заголовке личной или групповой переписки
открывать Telegram-подобную responsive панель с доступной информацией о собеседнике
или группе, общей медиатекой, скачиванием и переходом к исходному сообщению.

### Scope

- вся identity-зона заголовка чата является доступной кнопкой открытия профиля;
- единая desktop side-sheet/mobile full-screen panel работает для direct и group;
- direct показывает display name, username и best-effort online status;
- group показывает название, число и список участников, сохраняя существующие
  rename/add/remove/leave operations и authorization;
- вкладки «Медиа» и «Файлы» индексируют доступные attachment metadata последних
  2 000 retained сообщений, показывают preview, sender, дату и размер;
- каждое вложение можно скачать через существующий authenticated/E2EE-aware download
  path или открыть точное исходное сообщение с уже существующим target window;
- online failure использует encrypted local archive как bounded fallback, не добавляя
  server-side plaintext или отдельный attachment metadata index для direct chats.

### Security invariants

- direct filename/MIME/kind/key продолжают извлекаться только после client-side MLS
  decrypt; server не получает новый plaintext metadata contract;
- download повторно использует membership-authorized attachment endpoint, encrypted
  media cache и direct attachment cipher boundary;
- media index не обходит TTL, deletion tombstones или conversation membership;
- profile UI не вводит browser credentials, crypto keys или decrypted body в URL,
  logs, sync events или persistent presentation state;
- presence остаётся best-effort metadata и не используется для authorization.

### Tests

- unit: client-side media index декодирует metadata и сортирует newest-first;
- component: header identity emits profile intent;
- component: group management сохранился после объединения panel;
- component: direct identity, media/file counters и переход к exact source message;
- frontend Vitest, ESLint, Nuxt typecheck и production/PWA build.

### Exclusions

- server-side preview generation или расшифровка direct attachments;
- бессрочный media catalog за пределами server/local retention;
- новые profile bio/avatar upload schemas;
- изменение group MLS, storage quota или attachment size policy;
- отдельный backend media-search index, раскрывающий direct metadata.

### Definition of Done

- title/avatar click открывает профиль обоих типов conversation;
- доступные фото, видео и файлы быстро просматриваются и скачиваются;
- «К сообщению» загружает bounded timeline window и подсвечивает exact source row;
- group member-management regressions отсутствуют;
- relevant docs и checks обновлены, diff не содержит secrets/generated artifacts;
- изменения готовы к одному focused commit.

### Acceptance

- frontend: `65 passed` files, `391 passed` tests;
- ESLint и Nuxt typecheck проходят без diagnostics;
- production/PWA build завершён, service worker precache сгенерирован;
- in-app browser desktop `1280×720`: side sheet имеет bounded width `540 px`,
  document/panel не создают horizontal overflow;
- mobile `390×844`: panel занимает exact viewport, tabs и source/download actions
  доступны, `scrollWidth === clientWidth === 390`; visual QA отдельно исправил
  избыточную высоту file card на mobile;
- `git diff --check` проходит, temporary preview route удалён.
