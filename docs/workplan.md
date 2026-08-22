# Текущий workplan

## WP-122 — Android realtime, resilient history sync и status-bar continuity

Статус: **completed locally; authenticated release acceptance pending**
Backlog: `BL-082`
Bugs: `BUG-107`, `BUG-108`, `BUG-109`

Цель: восстановить realtime/presence в Capacitor Android без ослабления opaque
cookie policy, не позволять одному повреждённому history conversation останавливать
остальной device-to-device sync и визуально продолжить native background под
edge-to-edge status bar.

### Подтверждённые причины

- production HTTP Android проходит, но WebSocket handshake возвращает `403`:
  cross-origin WebView socket не получает `SameSite=Strict` host cookie API;
- history relay обрабатывается одним общим циклом, поэтому unreadable encrypted
  chunk выбрасывает всю попытку вместо bounded quarantine одного conversation;
- native auth layout начинается ниже safe-area, оставляя прямоугольную полосу
  root background вместо продолжения hero background.

### Scope

- Android-only Capacitor WebSocket adapter получает HttpOnly cookie внутри native
  CookieManager, отправляет её только в `wss` handshake exact realtime path и
  передаёт UI только bounded realtime frames;
- web/PWA сохраняют browser WebSocket и cookie transport без query credential;
- unreadable/corrupt history payload переводит только свой conversation в skipped,
  подтверждает relay chunk и продолжает остальные chats;
- pairing/device/conversation binding mismatch остаётся terminal fail-closed;
- auth background рисуется под status bar, controls сохраняют safe inset;
- authenticated mobile shell получает theme-aligned safe-area gradient;
- Pixel 9 AVD запускается headless, debug APK проверяется через ADB screenshot,
  process logs и production handshake.

### Security invariants

- session cookie не возвращается JavaScript, не логируется и не попадает в URL;
- native bridge принимает только `wss`, exact `/api/v1/realtime`, no query,
  credentials или fragment, и exact local app origin;
- API `SameSite=Strict`, CSRF, allowed origins и browser WebSocket не ослабляются;
- malformed decrypted transfer binding не признаётся harmless corruption;
- unreadable message content не логируется и не копируется в skip diagnostics.

### Tests

- Vitest: native socket URL/origin/no-query, ping/pong and event lifecycle;
- Vitest: corrupt chat quarantine continues other markers;
- Vitest: wrong pairing binding remains rejected and unacknowledged;
- mobile CSS regression for behind-status-bar paint and safe control inset;
- frontend test, lint, typecheck, native build/sync;
- Android Gradle debug compile and headless Pixel 9 install/launch/screenshot/logcat;
- production API logs show accepted native WebSocket after authenticated launch when
  an existing emulator session is available.

### Exclusions

- `SameSite=None`, bearer/query session credentials или public Origin wildcard;
- automatic repair of cryptographically unreadable history;
- clearing Android app data or replacing the user's production device identity;
- iOS native WebSocket bridge in this Android regression slice;
- release/tag/deploy without a separate explicit release step.

### Definition of Done

- Android presence/realtime connects through a cookie-aware native socket;
- one or more corrupt conversations are reported skipped while valid chats finish;
- status bar has continuous themed background and no overlapped controls;
- relevant checks and headless AVD acceptance pass;
- architecture/native docs, backlog and bugs describe the resulting boundary;
- changes are committed as one focused feature.

### Acceptance

- production API logs: authenticated Android HTTP requests return `200`, while the
  former JavaScript `/api/v1/realtime` handshakes repeatedly returned `403`; browser
  WSS in the same runtime remained accepted and Android origins were allow-listed;
- frontend: `64 passed` files, `388 passed` tests, ESLint and Nuxt typecheck;
- native: static build, Capacitor sync and Android Gradle `assembleDebug` pass;
- headless Pixel 9 API 37: latest debug APK installs and launches, app process stays
  alive, filtered logcat has no fatal/exception, and screenshot confirms continuous
  hero background beneath the `142 px` status inset;
- production accepted native WSS remains a release acceptance step because the
  headless AVD intentionally has no user production credentials.
