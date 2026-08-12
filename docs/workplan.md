# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-057 — Session-safe Telegram-like group media gallery

Статус: **completed** (`09177e7`; production run `31556674459`)
Backlog: следующий group-first slice `BL-043`; defects `BUG-057`, `BUG-058`

Цель: сделать отправку и просмотр group v1 фото/файлов предсказуемыми в обычном
browser и установленной PWA: media никогда не открывает неавторизованный внешний
контекст, session rotation сохраняется на streaming response, а одно сообщение
принимает до 10 ordered вложений с удобным preview/gallery UX.

### Product scope

- [x] picker принимает до 10 фото/файлов за выбор и позволяет добавлять следующий
  выбор до общего лимита;
- [x] composer показывает ordered preview всех выбранных элементов, размер/type,
  позволяет убрать один элемент или очистить набор;
- [x] один send загружает весь валидный набор и создаёт одно сообщение с caption и
  ordered attachment metadata/IDs;
- [x] изображения загружаются authenticated fetch внутри PWA и показываются
  адаптивной gallery без перехода во внешний browser/tab;
- [x] tap/click открывает fullscreen viewer внутри приложения; keyboard navigation,
  close и переключение между фото не ломают timeline;
- [x] произвольный файл скачивается authenticated fetch через bounded Blob URL с
  исходным безопасным display name;
- [x] loading, partial upload failure, retry, expired/unavailable и offline состояния
  видимы и не оставляют ложное «отправлено» сообщение.

### Security/session invariants

- [x] каждый media fetch использует same-origin `credentials: include`, membership
  и expiry всё равно проверяются backend;
- [x] frontend не помещает session credential в URL/storage и не создаёт permanent
  public/object URL; каждый Blob URL отзывается при замене/unmount;
- [x] rotated auth/CSRF cookies, выставленные authentication boundary, копируются в
  фактический `StreamingResponse`, чтобы media GET не рассинхронизировал session;
- [x] direct MLS v2 attachments остаются fail-closed; group v1 media по-прежнему
  честно отмечены как server-readable и имеют 30-day TTL;
- [x] набор ограничен 10 вложениями, существующие per-file size/quota/content-type
  проверки не ослабляются.

### Architecture и implementation

- [x] `AttachmentGateway` получает typed download operation; `ApiClient` отвечает
  только за credentialed binary transport;
- [x] отдельный application use case валидирует conversation/attachment scope и
  bounded downloaded Blob;
- [x] `useMessenger` оркестрирует batch upload и передаёт ordered metadata/IDs в
  существующий outbox/message flow;
- [x] visual components владеют picker/viewer interaction и ephemeral Blob URL, но
  не делают raw fetch;
- [x] backend streaming route сохраняет response cookies без изменения storage/use
  case boundary.

### Tests и acceptance

- [x] backend regression: rotation на attachment GET возвращает новый Set-Cookie и
  следующий authenticated request остаётся valid;
- [x] frontend unit/component: single image, 10-item batch, add/remove, 11th reject,
  ordered upload/message, partial failure/retry, file download, viewer close/nav,
  unavailable response и отсутствие `_blank` media navigation;
- [x] backend ruff/format/mypy/pytest и frontend lint/typecheck/Vitest/build зелёные;
- [x] isolated Compose stack: admin + второй пользователь, group, single photo,
  batch photos, mixed file, receive/open/download/reload в реальном browser;
- [x] после merge/deploy проверены migration/health/logs и отсутствие влияния на
  host Nginx, `yoowee.ru` и `s3.yoowee.ru`.

### Ограничения

- текущий slice не добавляет direct E2EE attachments, resumable/chunk upload,
  offline media draft persistence, OPFS cache, drag/drop/paste или image editor;
- server-side thumbnailing/transcoding и новый storage service не добавляются;
- batch upload может быть ограниченно последовательным: корректность, quota и
  повторяемый UX важнее параллельной нагрузки на малый VPS.

### Local acceptance evidence

- полный `make ci`: backend `223 passed, 8 skipped`, crypto `21 passed`, frontend
  `195 passed`, production Nuxt/PWA build и Compose/deploy/docs checks зелёные;
- isolated project `yv-chat-wp057` на `127.0.0.1:18100`: fresh migration `base →
  0019`, admin + activated receiver, group message с 10 PNG и caption, отдельный
  Markdown file;
- sender/receiver открыли fullscreen viewer, keyboard next, file Blob download без
  URL navigation и reload с 10 доступными фото; media GET вернули `200`, в API logs
  нет `401/403/409/422/500` или traceback;
- acceptance отдельно выявил stale directory snapshot (`BUG-059`), не связанный с
  media transport; чистый origin получил authoritative directory и завершил flow.

### Production evidence

- independent CI run `31556674451` и deploy run `31556674459` завершились успешно;
- production API/frontend используют immutable `sha-09177e7...`, migration —
  `0019_group_attachments (head)`, API/frontend/PostgreSQL healthy;
- production API logs после rollout не содержат HTTP 401/500, traceback или error;
- public `chat` app/health отвечают `200`, anonymous attachment — ожидаемым `401`;
  host Nginx `active`, `yoowee.ru` отвечает `200`, anonymous root `s3.yoowee.ru` —
  ожидаемым `403` без TLS/connection failure.

### Definition of Done

- пользователь отправляет одним group message до 10 фото/файлов и управляет набором
  до send;
- получатель без 401 открывает фото во встроенной gallery и скачивает файл;
- attachment GET не теряет session credential rotation;
- ошибки не ломают session/timeline и дают безопасный повтор;
- automated checks, реальный browser acceptance, docs, focused commit и production
  verification завершены.
