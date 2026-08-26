# Текущий workplan

## WP-135 — Настоящий offline cold start установленной PWA

Статус: **implemented and locally verified; production rollout pending**
Backlog: `BL-FIX-064`

Цель: уже установленная и хотя бы один раз успешно синхронизированная PWA должна
открывать app shell, список диалогов, encrypted local history и ранее закэшированные
media без доступа к серверу. Offline не подтверждает действительность server session
и не разрешает server-only действия; первый authoritative `401` по-прежнему завершает
локальный authenticated UI.

### Root cause

- Workbox регистрировал navigation fallback на `/`, но Nuxt `build` не помещал `/`
  или `index.html` в precache manifest. Холодная navigation поэтому зависела от
  живого frontend container и падала раньше запуска Vue/IndexedDB;
- после загрузки shell auth middleware всегда требовал успешный `/api/v1/me`.
  `CurrentAccount` хранился только в памяти Vue, поэтому network error оставлял
  `user = null` и отправлял уже авторизованную установку на `/login` до hydration
  encrypted messenger snapshot;
- message snapshot/archive и media cache уже имеют cache-first read paths, но были
  недостижимы из-за этих двух startup gates.

### Scope

- генерировать и precache-ить реальный versioned SPA HTML fallback для navigation;
- хранить последний подтверждённый `CurrentAccount` в отдельном bounded encrypted
  IndexedDB store под non-extractable AES-GCM key;
- использовать cached account только после transient/network bootstrap failure;
  никогда не использовать его после authoritative `401`;
- очищать cached account после logout/security reset/session expiry и обновлять после
  login, `/me`, profile update или device re-enrollment;
- позволить auth middleware открывать `/chat` и `/settings` с cached account в
  explicit offline phase;
- сохранить cache-first message/media behavior и честно показывать unavailable для
  media, которые устройство никогда не открывало или уже evict-нуло.

### Tests

- encrypted offline-account store: round-trip, non-extractable key, ciphertext не
  содержит username/display name, tamper fail-closed, clear;
- auth regression: cold offline bootstrap восстанавливает cached account, transient
  failure без cache остаётся на offline login surface, `401` очищает cache и не
  восстанавливает пользователя;
- production build: generated Service Worker содержит существующий precached HTML
  navigation fallback;
- Docker Browser QA: один online cold start создаёт local snapshot, затем backend и
  network становятся недоступны; reload `/chat` и переходы Chat/Settings продолжают
  работать без page-load error. Ранее cached media остаётся отдельным cache-first
  application regression поверх encrypted `EncryptedMediaCache`.

### Exclusions

- не обещать offline-доступ к media, которые никогда не были скачаны на устройство;
- не выполнять offline admin/security/device operations как будто сервер подтвердил их;
- не переносить HttpOnly session credential в IndexedDB/localStorage;
- не добавлять Service Worker Background Sync до cross-release storage gate `BL-025`.

### Definition of Done

- frontend unit suite, lint, typecheck и production/PWA build проходят в Docker;
- Compose config валиден, diff не содержит secrets или plaintext local archive;
- реальный browser reload с выключенной сетью открывает cached `/chat`, сохраняет
  навигацию и не показывает browser-level «не удалось загрузить страницу»;
- production rollout использует exact immutable image tag и проходит health/runtime
  verification.

### Verification 2026-08-27

- `docker build --target build -t yv-chat-wp135-frontend-check ./frontend` — passed;
- generated `.output/public/index.html` существует, а `sw.js` содержит precached `/`
  и `createHandlerBoundToURL("/")` — passed;
- Docker Vitest: `67` files, `424` tests — passed;
- Docker ESLint и Nuxt typecheck — passed;
- real Browser QA: создан direct chat и локальное сообщение, затем остановлены nginx,
  frontend, API и PostgreSQL; cold reload exact `/chat?conversation=…`, переход
  Settings → Chat и повторный render сообщения — passed.
