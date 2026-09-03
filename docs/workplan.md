# Текущий workplan

## WP-143 — Нативный и производительный photo flow

Статус: **production deployed**
Backlog: `BL-FIX-070`
Bug: `BUG-132`

Цель: длинные серии фотографий не должны декодировать полноразмерные изображения
в timeline или заново читать original media после каждого remount/reload. Photo
viewer должен масштабировать изображение вокруг точки жеста и всегда закрываться
крестиком, Escape и системным Back, а мобильный media action должен открывать
системный photo/video picker вместо общего файлового chooser.

### Scope

- создавать bounded 512 px timeline thumbnail только после попадания карточки около
  viewport и ограничивать тяжёлую генерацию двумя параллельными jobs;
- хранить group thumbnail как отдельный AES-GCM encrypted вариант в существующем
  device media cache; direct thumbnail оставлять только в bounded hot memory, чтобы
  persistent direct cache продолжал хранить исключительно ciphertext;
- читать full-resolution Blob только при fullscreen/open/download/video flow;
- добавить browser-native lazy/async image decoding и уменьшить preload margin;
- вычислять pinch zoom относительно текущего centroid с одновременным two-finger pan;
- держать viewer controls поверх transformed image и закрывать viewer независимо от
  zoom через close/backdrop/Escape/browser-or-system Back;
- вернуть media input к exact `accept="image/*,video/*"`; audio остаётся доступным
  через unrestricted file action.

### Security и privacy

- server upload/download, membership, TTL, quota и direct MLS contracts не меняются;
- group thumbnail шифруется тем же non-extractable per-user-device cache key и
  привязывается AAD к original attachment metadata, expiry и variant;
- direct preview не записывается в persistent cache, OPFS или IndexedDB;
- full-resolution object URLs остаются transient и отзываются при removal/unmount.

### Tests

- persistent group thumbnail переживает новый download use-case instance и не читает
  original cache/server повторно; direct preview не persist-ится;
- несколько preview misses coalesce-ятся и не запускают больше двух thumbnail jobs;
- timeline использует preview URL, viewer переключается на full-resolution URL;
- pinch сохраняет изображение под изменяющимся centroid, close работает при zoom > 1,
  Back закрывает viewer без выхода из чата;
- media input содержит exact photo/video accept без audio;
- frontend tests, lint, Nuxt typecheck и production/PWA build;
- Docker Browser acceptance на desktop и mobile viewport с network/performance smoke.

### Exclusions

- server-side thumbnailing/transcoding или plaintext direct media на сервере;
- изменение attachment/message schema, E2EE protocol, TTL или quota;
- native-only Android/iOS photo library plugin;
- виртуализация всей message timeline.

### Definition of Done

- повторное открытие group photo timeline использует маленький encrypted local
  thumbnail и не декодирует/читает original до явного fullscreen;
- серия media сообщений не создаёт unbounded concurrent decode work;
- pinch focal point, close controls и system Back ведут себя предсказуемо при любом zoom;
- Android-compatible media picker снова ограничен photo/video;
- relevant automated checks и Docker Browser acceptance зелёные;
- workplan, backlog и bug record синхронизированы, diff проверен и feature commit создан.

### Verification

- `454` frontend tests passed, включая encrypted preview variant, reload reuse,
  direct ciphertext-only persistence, 50-image/two-job concurrency, focal pinch,
  zoomed close и browser Back regressions;
- ESLint, Nuxt typecheck и production/PWA build прошли;
- `docker compose config` прошёл, integrated stack собран и healthy, локальный
  `/api/v1/health` ответил `200`;
- Docker Browser acceptance: desktop authenticated chat и mobile `390×844`, exact
  `image/*,video/*`, gallery label, zero horizontal overflow и zero console errors.
- После первого production push новый dependency audit заблокировал rollout до
  выкладки; транзитивные `@xmldom/xmldom` и `fast-uri` обновлены до исправленных
  версий, чистый `npm ci` и полный frontend gate повторно прошли (`BUG-133`).
- production commit `67abecb797b8b450e8fb340abb8f21faa55a0704` развернут
  workflow `33751357406`; отдельный CI `33751357577` прошёл полностью;
- оба production origin и их `/api/v1/health` вернули HTTP `200` с успешной TLS
  verification; unauthenticated WebSocket handshake достиг API и вернул ожидаемый
  `403`, а свежий PWA bundle открыл login shell без console errors.
