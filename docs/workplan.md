# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-058 — Group video playback and intentional media/file picker

Статус: **completed** (`0bc2424`; CI `31575085202`; production run `31575085192`)
Backlog: следующий group-first slice `BL-043`

Цель: довести group v1 attachments до понятного mobile/desktop flow: пользователь
отдельно открывает системную галерею для фото/видео либо системный файловый picker
без ограничения по расширению, видит ordered preview до отправки и воспроизводит
поддерживаемое браузером видео внутри PWA без перехода в новый tab.

### Product scope

- [x] attachment action открывает компактное меню «Фото или видео» / «Файл»;
- [x] media picker использует `accept="image/*,video/*"`, поддерживает multiple и
  добавляет выбранное к текущему набору до общего лимита 10;
- [x] file picker не задаёт `accept` и позволяет отправить любой тип файла в
  пределах настроенного размера, включая неизвестный/пустой browser MIME;
- [x] composer показывает image/video preview, имя, размер, порядковое добавление,
  удаление одного элемента и очистку набора;
- [x] поддерживаемые video MIME получают отдельный `video` kind и воспроизводятся
  inline в сообщении и fullscreen viewer с native controls;
- [x] неподдерживаемый браузером видео-кодек не ломает timeline: остаются имя,
  размер и authenticated download;
- [x] viewer объединяет фото и видео одного сообщения, поддерживает close,
  previous/next, keyboard и touch navigation и останавливает видео при уходе.

### Security, storage и compatibility

- [x] произвольный file всегда скачивается как attachment + octet-stream; HTML/SVG
  и другой active content не исполняются inline;
- [x] inline response разрешён только bounded allowlist image/video MIME и имеет
  `nosniff`, private/no-store и membership authorization;
- [x] media bytes остаются server-readable group v1 data с 30-day TTL; direct MLS
  attachments остаются fail-closed;
- [x] per-file limits: image 12 MiB, generic file 25 MiB, video 100 MiB; общий
  quota остаётся bounded и не меньше максимального одиночного вложения;
- [x] новая DB constraint добавляется только новой Alembic migration; `0019` не
  переписывается, старые image/file сообщения продолжают декодироваться;
- [x] object URLs bounded жизненным циклом component и отзываются при cleanup.

### Architecture и implementation

- [x] domain/application/transport DTO расширяются typed `video` kind без raw
  fetch или crypto/storage logic во Vue component;
- [x] backend `AttachmentPolicy` централизует video allowlist и отдельный limit;
- [x] streaming presentation выбирает safe response media/disposition из kind,
  сохраняя session-rotation `Set-Cookie` на фактическом response;
- [x] frontend upload/download use cases валидируют type/kind/size одинаково с
  серверным контрактом;
- [x] picker/menu/viewer остаются presentation interaction, transport идёт через
  существующий `AttachmentGateway`;
- [x] SHA-256 вычисляется инкрементально по Blob stream без полного 100 MiB
  `arrayBuffer` в памяти мобильного устройства;
- [x] Compose/env/README/deployment/architecture отражают новый limit и поведение.

### Tests и acceptance

- [x] backend policy/API tests: allowed video, forged video MIME reject, generic
  arbitrary MIME, oversize, auth/non-member, inline/attachment headers и cookie
  rotation regression;
- [x] migration: fresh PostgreSQL upgrade to head и upgrade `0019 -> 0020`;
- [x] frontend unit/component tests: media/file picker split, 10-item accumulation,
  video upload metadata, composer preview, inline player/viewer, download fallback,
  close/navigation cleanup и old image/file envelope compatibility;
- [x] backend ruff/format/mypy/pytest, frontend lint/typecheck/Vitest/build,
  crypto/Compose/deploy/docs checks зелёные;
- [x] isolated Compose + real browser: group sends image + playable video + arbitrary
  file, second session can view/download after reload without 401/500;
- [x] после deploy проверены migration/health/logs, host Nginx и домены.

### Exclusions

- direct E2EE attachments, encrypted thumbnails, resumable/chunk upload, server
  transcoding, codec conversion и streaming range requests не входят в этот slice;
- «любой файл» означает любой тип/расширение внутри size/quota/security policy, а
  не неограниченный размер;
- browser/OS определяет конкретный вид системной галереи; PWA задаёт корректный
  media intent, но не рисует собственный доступ к системной фототеке.

### Local acceptance evidence

- полный `make ci`: backend `224 passed, 8 skipped`, crypto `21 passed`, frontend
  `197 passed`, production Nuxt/PWA build, Compose/deploy/docs checks зелёные;
- PostgreSQL isolated project `yv-chat-wp058` прошёл fresh `base -> 0019`, затем
  upgrade `0019 -> 0020_video_attachments (head)`;
- real browser с двумя независимыми origins/users отправил одним group message PNG,
  `video/quicktime` MOV и Markdown file; receiver после reload увидел весь набор;
- inline и fullscreen video player имеют native controls, `readyState=4`, media
  error отсутствует; image/video/file GET вернули `200`, browser console без errors;
- frontend regression запрещает whole-Blob `arrayBuffer()` и проверяет exact
  incremental SHA-256 receipt для attachment transport.

### Production evidence

- GitHub CI `31575085202` завершил backend, Rust/OpenMLS, frontend и Compose jobs;
- deploy run `31575085192` собрал immutable images `sha-0bc2424...`, применил
  миграции и штатно развернул изолированный yv-chat stack;
- на `ru1` system Nginx `active`, отдельного yv-chat Nginx container нет, API,
  frontend и cleanup работают на новых images, PostgreSQL остаётся healthy;
- production Alembic сообщает `0020_video_attachments (head)`, loopback и public
  API health возвращают `{"status":"ok"}`, свежие API/cleanup logs без ошибок;
- соседние `yoowee.ru` и приватный `s3.yoowee.ru` сохранили штатные HTTP ответы
  (`302` и `403` соответственно).

### Definition of Done

- пользователь осознанно выбирает gallery либо files и отправляет до 10 элементов;
- поддерживаемое видео смотрится внутри PWA, остальные файлы безопасно скачиваются;
- произвольный active content не становится inline-origin document;
- старые вложения совместимы, миграции и все проверки зелёные;
- browser acceptance, focused commit, push и production verification завершены.
