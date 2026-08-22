# Текущий workplan

## WP-121 — Android native origin, QR и safe-area acceptance

Статус: **in progress**
Backlog: `BL-081`
Bugs: `BUG-105`, `BUG-106`

Цель: сделать подписанное Android-приложение реально пригодным для входа и
device pairing, не ослабляя exact-origin/CSRF boundary и не меняя поведение web/PWA,
а также устранить перекрытие auth UI системными bars на edge-to-edge Android.

### Scope

- сохранить отдельный local WebView origin `https://app.yvchat.local` и remote API
  origin `https://chat.yoowee.ru`;
- разрешить exact Android origin в production backend CORS/origin allowlist без
  wildcard и без изменения browser cookie policy;
- передавать trusted QR origins только native release build и валидировать их до
  Nuxt generation;
- сделать Android edge-to-edge inset handling одинаковым на поддерживаемых API и
  ограничить auth safe-area layout native root class;
- добавить regression tests для release workflow/build config, QR allowlist,
  platform class, safe-area и неизменного PWA boundary;
- проверить обычный web/PWA build, native bundle/sync, signed release APK и запуск
  на локальном Pixel 9 AVD;
- выпустить signed `v1.0.1`, который обновляет `v1.0.0` без смены application ID или
  certificate.

### Security и compatibility invariants

- `de.com.yoowee.chat` остаётся installation identity, а не network origin;
- local bundle не получает `server.url`/remote navigation и не маскируется под API
  domain;
- backend принимает только exact configured web/native origins; wildcard запрещён;
- QR allowlist содержит только exact origins без path/query/credentials;
- web/PWA продолжают relative same-origin API, VAPID Service Worker и прежний
  session/IndexedDB/OPFS lifecycle;
- native app продолжает использовать opaque HttpOnly cookie, double-submit CSRF и
  отдельный WebView storage/device identity;
- signing key, Firebase credentials, cookies, QR tokens и crypto material не
  попадают в repository, logs или APK assets.

### Exclusions

- смена application ID, signing certificate или WebView storage origin;
- public CORS wildcard, bearer-token auth или ослабление CSRF;
- Google Play/App Store publication;
- physical iOS compile/sign/acceptance без полного Xcode и Apple provisioning;
- гарантии для vendor-specific Android bars вне проверенного Capacitor/API contract.

### Definition of Done

- password login с Android native origin доходит до credential validation вместо
  pre-auth `403`;
- Android scanner принимает QR от обоих production web origins, а arbitrary origin
  по-прежнему отклоняется локально;
- auth UI, chat shell, tabs/composer и keyboard flow не перекрываются status/navigation
  bars на Pixel 9 AVD;
- frontend tests, lint, typecheck, web/PWA build, native build/sync и Android signed
  release build проходят;
- production exact origin обновлён атомарно с backup, API healthy, web/PWA smoke
  остаётся зелёным;
- GitHub Release `v1.0.1` опубликован и signature/package/version проверены.

### Проверка

- pending implementation.
