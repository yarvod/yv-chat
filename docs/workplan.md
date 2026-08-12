# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-056 — Фото и файлы в групповых чатах с 30-дневным media TTL

Статус: **in progress**
Backlog: `BL-016`, group-first slice `BL-043`, media часть `BL-018`

Цель: дать участникам групп удобную отправку изображений и произвольных файлов,
не выдавая этот v1 flow за E2EE. Media хранится на серверном local volume не дольше
30 дней; direct MLS v2 conversations fail-closed для attachments до отдельного
client-side encrypted flow.

### Product scope

- [x] attachment button открывает photo/file picker на mobile и desktop;
- [x] выбранное вложение видно до отправки, его можно отменить, upload/send имеет
  понятный busy/error/retry state;
- [x] group message поддерживает caption либо attachment-only send;
- [x] изображения показываются внутри bubble с пропорциональным preview и
  открываются по нажатию; другие файлы имеют name/type/size и download action;
- [x] expired/missing media отображается понятным unavailable state без поломки
  timeline и остальных сообщений;
- [x] существующие text messages, sync, ordering, idempotency и mobile composer не
  деградируют.

### Backend и storage boundary

- [x] application зависит от узкого `MediaStorage` port; default adapter —
  `LocalMediaStorage(/data/media)`, absolute paths не попадают в БД/API;
- [x] server генерирует opaque storage key и пишет upload потоково через atomic
  temporary file/rename; client filename никогда не используется как path;
- [x] metadata/ownership/message binding хранятся отдельно через migration и typed
  repository/UoW; ORM не выходит из infrastructure;
- [x] upload/download требуют active group membership, direct conversation получает
  явный rejection, чужое pending attachment нельзя привязать к сообщению;
- [x] limits включают bounded file count, image/file bytes, filename/content-type,
  per-user quota и chunked processing без unbounded backend RAM;
- [x] pending upload имеет короткий TTL, committed media получает `expires_at`
  сообщения (default 30 days); cleanup bounded/idempotent и терпит missing blob;
- [x] production Compose монтирует persistent media volume в API и cleanup, не
  публикует новый порт и не затрагивает host Nginx или `s3.yoowee.ru`.

### Protocol и security contract

- [x] текущий group v1 upload server-readable и явно помечен как **не E2EE**;
- [x] direct MLS v2 не принимает plaintext attachment IDs/bytes и не получает
  downgrade/synthetic fallback;
- [x] API никогда не логирует media content, session credentials или filesystem path;
- [x] original filename — только bounded client display metadata; server
  `Content-Disposition` его не отражает, sniffed/executable content не выполняется
  inline;
- [x] download повторно проверяет membership, expiry и committed state;
- [x] будущий S3 adapter реализует тот же port и использует уже сохранённый opaque
  key, поэтому domain/application и message schema не зависят от filesystem.

### Frontend boundaries

- [x] transport DTO/gateway, upload use case и presentation state разделены;
- [x] raw network calls и Blob URL lifecycle не размазываются по visual components;
- [x] attachment metadata входит в authoritative snapshot/sync и local archive;
- [x] direct composer скрывает/блокирует attachment action с ясным объяснением;
- [x] image/file rendering не пытается расшифровать group v1 media и не называет его
  защищённым.

### Tests и acceptance

- [x] domain/application: policy, ownership, idempotent message retry, quota и TTL;
- [x] infrastructure: traversal, partial write cleanup, missing delete, persistence;
- [x] HTTP/application boundary: upload/download group happy path;
  direct/non-member/expired/oversize/
  чужой attachment negative cases;
- [x] cleanup: pending и committed expiry, repeat/concurrent-safe bounded batches;
- [x] migration: fresh PostgreSQL `base -> head` и upgrade from previous head;
- [x] frontend: picker/cancel/upload, photo/file bubble, attachment-only send,
  direct fail-closed и expired state;
- [x] backend ruff/format/mypy/pytest, frontend lint/typecheck/Vitest/build,
  compose config и полный `make ci` зелёные;
- [ ] production rollout: migration, persistent volume, health/log/API smoke и
  отсутствие влияния на `yoowee.ru`/`s3.yoowee.ru`.

### Ограничения

- этот slice не является E2EE media и не добавляет direct attachments;
- gallery/multi-select, drag-and-drop/paste, OPFS encrypted media cache и offline
  resumable/chunk protocol могут остаться следующими slices после одного файла;
- server-side thumbnailing/transcoding и MinIO не добавляются;
- TTL удаляет server copy; уже скачанный пользователем файл удалённо уничтожить
  невозможно.

### Definition of Done

- фото и файлы удобно отправляются/получаются только в group v1;
- media не переживает server TTL и хранится в persistent local volume;
- direct MLS confidentiality не понижена;
- storage implementation заменяема на S3 adapter без изменения use cases;
- tests, docs, focused commit и production verification завершены.
