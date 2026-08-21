# Текущий workplan

## WP-116 — Capacitor native shell and capability boundary

Статус: **completed locally; physical platform acceptance pending**
Backlog: `BL-079`

Цель: добавить воспроизводимые iOS/Android проекты поверх того же Nuxt UI и
подключить первые нативные capabilities, не меняя web/PWA runtime.

### Scope

- Capacitor 8 config и committed iOS/Android shell projects;
- отдельный native build/sync workflow, использующий локальный Nuxt bundle, а не
  production `server.url`;
- configurable remote API/realtime origin только для native bundle; web/PWA по
  умолчанию сохраняют относительный same-origin transport;
- exact native WebView origins в CORS/Origin/CSRF boundary без wildcard;
- native cookie/HTTP bridge для существующей opaque `HttpOnly` session и публичного
  double-submit CSRF cookie без JavaScript bearer tokens;
- native system bars, keyboard behavior, app foreground/deep-link lifecycle и
  semantic Capacitor haptics;
- capability-aware Settings copy и platform regression tests;
- documentation/runbook для prerequisites, generated secrets exclusion и build.

### Security и architecture invariants

- native wrapper использует тот же revocable device-bound opaque session; bearer
  credential не попадает в localStorage, IndexedDB, URL или WebSocket query;
- API и WebSocket принимают только explicit configured origins, wildcard запрещён;
- `server.url` не используется в production native build;
- direct message/call E2EE, media path и server cursor semantics не меняются;
- Capacitor APIs находятся за ports/adapters; Vue components не вызывают native SDK;
- web/PWA adapters и service-worker Web Push продолжают работать без Capacitor.

### Exclusions

- APNs/FCM server delivery и native incoming-call system surfaces — отдельные
  последующие workplans, потому что требуют provider credentials, persistence и
  CallKit/Android Telecom threat/permission review;
- store signing, provisioning profiles, App Store/Play Console publication;
- перенос crypto keys между browser PWA и native installation;
- изменение WebRTC signaling/media protocol.

### Definition of Done

- web/PWA checks остаются зелёными с пустым native API origin;
- Capacitor config не содержит remote `server.url`, secrets или wildcard navigation;
- Android/iOS shells синхронизируются из production Nuxt bundle;
- semantic haptics используют native engine только в Capacitor и browser fallback в web;
- exact origin, API URL и realtime URL regressions покрыты tests;
- platform builds запущены там, где local SDK доступен, а отсутствующие SDK явно
  отмечены, не выдаются за проверенные.

### Проверка

- Capacitor CLI sync успешно создал/обновил оба platform project и нашёл пять
  official plugins;
- native static generate с exact HTTPS API origin проходит, Service Worker в нём
  отсутствует; обычный web production build по-прежнему генерирует PWA SW;
- frontend: `369 passed`, ESLint, Nuxt typecheck и production web build зелёные;
- backend: Ruff check/format, mypy и `283 passed, 12 skipped` зелёные;
- npm audit после pin Capacitor CLI `8.4.2`: `0 vulnerabilities`;
- Android compile не запускался: Android SDK/`ANDROID_HOME` отсутствуют;
- iOS compile не запускался: установлен только Xcode Command Line Tools, полный
  Xcode недоступен;
- cookie/IndexedDB/OPFS/WebSocket physical acceptance остаётся обязательным rollout
  gate и не считается подтверждённым статическими tests.
