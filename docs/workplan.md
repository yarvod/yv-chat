# Текущий workplan

## WP-144 — Durable encrypted previews для фото в личных чатах

Статус: **production deployed** (`03f946d`, workflow `33763879833`; CI
`33763879822`)
Backlog: `BL-FIX-071`
Bug: `BUG-134`

Цель: уже открытые фотографии direct MLS-чата после закрытия и повторного запуска
приложения должны сразу читаться из маленького локального preview cache, а не снова
проходить ciphertext read, attachment decrypt и thumbnail generation.

### Scope

- сохранять `timeline-preview-v1` direct thumbnail через существующий
  `EncryptedMediaCache` после локальной MLS-authorized расшифровки original;
- при следующем application instance сначала читать encrypted preview и не запускать
  original OPFS read, attachment decrypt, server download или image resize;
- сохранить общий 2 GiB LRU, server expiry, owner user/device binding и общий clear;
- проверить повторный запуск на серии из 50 direct-фотографий.

### Security и privacy

- preview никогда не отправляется на server и не хранится plaintext в OPFS/IndexedDB;
- cache шифрует thumbnail non-extractable per-user-device AES-256-GCM key с AAD по
  owner/device/conversation/attachment metadata, expiry, variant, size и MIME;
- server original остаётся application/octet-stream direct ciphertext; attachment key
  и decrypted full-resolution Blob существуют только внутри client boundary;
- logout/device clear удаляет preview вместе с остальным device media cache.

### Tests

- direct preview переживает новый download use-case/application instance;
- 50 direct photos после reload дают 50 encrypted preview hits без дополнительных
  gateway download, attachment decrypt или thumbnail generation;
- persistent preview bytes не содержат plaintext и читаются новым cache instance;
- полный frontend test/lint/typecheck/build gate и Docker smoke.

### Exclusions

- plaintext direct preview persistence;
- server-side thumbnailing, direct media decrypt или изменение MLS envelope;
- изменение attachment API, TTL, quota или IndexedDB schema version.

### Definition of Done

- после первого успешного показа direct-фотографии следующий app start использует
  encrypted bounded thumbnail;
- длинная direct photo timeline не показывает последовательную очередь повторной
  decrypt/decode работы;
- security invariants, automated checks, Docker smoke и tracking docs зелёные;
- focused commit создан и готов к production rollout.

### Verification

- regression сначала воспроизвёл `0` persistent preview reads для direct reload;
- после исправления targeted direct/media-cache suite: `29/29` tests passed;
- 50-photo reload regression подтверждает отсутствие повторных gateway/decrypt/resize;
- новый cache instance расшифровывает preview, raw persisted bytes не содержат
  thumbnail plaintext;
- полный frontend suite: `74` test files, `455/455` tests passed;
- `npm run lint`, `npm run typecheck`, `npm run build` — passed;
- `npm audit --audit-level=high` — `0` vulnerabilities;
- Docker production build и health smoke — passed (`5` сервисов healthy/running,
  `/api/v1/health` вернул `{"status":"ok"}`);
- Browser smoke после PWA update и повторного reload direct-чата — direct route и
  active sync восстановились, console errors отсутствуют; локальный direct fixture
  пуст, поэтому 50-photo reload покрыт автоматизированным cache/use-case regression;
- GitHub CI `33763879822` и production deployment `33763879833` завершились
  успешно для immutable commit `03f946d5d8365add8136236160e4f928c305aecd`;
- post-rollout HTTPS health на `chat.yoowee.ru` и `chat.yoowee.com.de` вернул
  `{"status":"ok"}`, чистая production UI-сессия открыла `/login` без console errors.
