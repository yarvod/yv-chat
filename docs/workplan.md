# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-051 — Encrypted photo/file vertical slice

Статус: **in progress**
Backlog: `BL-016`, `BL-017`, `BL-043`

Цель: добавить удобную отправку фотографий и произвольных файлов через
client-side encryption и bounded local filesystem storage. Direct attachment key и
metadata доставляются внутри MLS v2 и остаются E2EE; group v1 использует тот же
encrypted-blob format, но envelope доступен серверу и поэтому честно остаётся без E2EE.

### Scope и security contract

- [ ] `MediaStorage` application port и потоковый `LocalMediaStorage` adapter хранят
  только opaque encrypted bytes под server-generated key в `/data/media`.
- [ ] Attachment domain/application operations отделены от FastAPI/SQLAlchemy:
  upload, commit-to-message, authorized download и orphan/expired cleanup.
- [ ] Alembic migration хранит conversation/uploader, opaque storage key, bounded
  routing metadata, ciphertext size/status/timestamps; absolute path, client filename,
  file key и plaintext metadata в БД отсутствуют.
- [ ] Upload/download API под `/api/v1` проверяет session, CSRF/Origin для upload,
  membership, ownership, MIME allowlist, per-file limits и quota/admission policy.
- [ ] Backend пишет upload потоково через atomic temporary file + rename, удаляет
  partial files при ошибке и не грузит произвольный файл целиком в RAM.
- [ ] Frontend file crypto изолирован за adapter/service boundary: random AES-GCM key
  и nonce, authenticated encryption до upload, decrypt только на authorized device.
- [ ] Versioned message content DTO содержит caption и ordered attachment descriptors;
  direct descriptor защищён MLS v2, group descriptor доступен серверу и помечен non-E2EE.
- [ ] Outbox сохраняет upload/send lifecycle идемпотентно, показывает progress,
  retry/cancel и не создаёт duplicate message/attachment при повторе.
- [ ] Фото выбираются picker/camera, paste и drag/drop; bubble показывает gallery,
  viewer, caption и понятные loading/unavailable/expired states.
- [ ] Произвольный файл показывает локально расшифрованные name/type/size и безопасное
  download/open действие; имя никогда не используется backend как путь.
- [ ] Локальный media cache bounded/evictable; object URLs освобождаются, plaintext
  blobs не сохраняются в localStorage/обычный IndexedDB.
- [ ] Compose/deploy создаёт persistent media volume с минимальными правами; host
  Nginx body limit согласован с application limit без второго nginx-контейнера.
- [ ] README, architecture, API/deployment docs и backlog отражают точные гарантии,
  ограничения и различие direct E2EE/group non-E2EE.

### Tests и acceptance

- [ ] Backend unit/security/integration: traversal, oversize, wrong MIME, non-member,
  cross-conversation attach, duplicate commit, partial write, missing file и cleanup.
- [ ] Fresh migration `0001 → head` и upgrade from previous head проходят.
- [ ] Frontend unit tests: payload codec, encryption corruption, upload progress,
  retry/cancel, exact protocol policy, gallery/file presentation и URL cleanup.
- [ ] Полный `make ci`, migration/config checks и secret/diff review.
- [ ] Реальный browser flow на двух origins: direct photo/file E2EE send/download,
  group non-E2EE warning, reload/sync, offline retry и unauthorized download reject.
- [ ] Immutable deploy, production health/log/storage permission verification и
  проверка, что `yoowee.ru`/`s3.yoowee.ru` не затронуты.

### Ограничения первого slice

- bounded whole-file WebCrypto operation с небольшим documented per-file limit;
  resumable chunk crypto остаётся отдельным hardening до поддержки больших файлов;
- без server-side thumbnailing/transcoding/virus inspection plaintext;
- без S3/MinIO adapter: single-VPS default остаётся `/data/media`;
- без background OS download manager и без бессрочного local media cache;
- group attachments не называются E2EE до возврата group MLS в `BL-051`.

### Definition of Done

- два устройства передают фото и файл без появления plaintext/key в backend storage,
  логах или transport metadata direct conversation;
- сервер никогда не использует client filename как путь и проверяет membership на
  upload/download/commit;
- повтор/обрыв не оставляет бесконечные partial files и не создаёт duplicate message;
- UI удобен на mobile/desktop и не ломает фиксированный messenger layout;
- полный CI, реальный browser acceptance и production rollout зелёные.
