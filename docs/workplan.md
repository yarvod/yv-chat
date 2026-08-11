# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-020 — Native-feeling PWA shell и frontend Clean Architecture

Статус: **in progress**
Backlog item: `BL-038`
Цель: превратить разросшийся route-less frontend в installable responsive
application shell с явными dependency boundaries, отдельными страницами,
автоматическим device label, темами, motion и capability-safe haptics.

### Результат

`app.vue` остаётся composition/render shell без auth/business orchestration.
Nuxt pages разделяют login, activation, messenger, settings и admin routes;
layouts дают desktop sidebar и mobile bottom navigation. Presentation вызывает
typed application operations, application зависит от domain и ports, browser/
HTTP implementations живут в infrastructure. UI одинаково пригоден для узкого
mobile viewport, installed standalone PWA и desktop browser.

### Invariants

1. Dependency direction frontend: `presentation → application → domain`, а
   `infrastructure` реализует application ports и подключается в composition root.
2. Vue pages/components не вызывают raw `fetch`, `localStorage`, User-Agent API,
   Vibration API или crypto primitives.
3. Transport DTO остаётся `unknown` до runtime parsing; transport DTO, domain
   model и presentation view model не смешиваются.
4. Browser session credential по-прежнему только в secure HttpOnly cookie;
   local storage разрешён только для несекретных theme/haptics preferences.
5. Login не показывает поле имени устройства. Bounded best-effort label строится
   автоматически из browser/OS/device-class metadata и не используется как auth
   factor. Позже пользователь сможет переименовать device в settings.
6. Invite secret читается из URL fragment, который не уходит в HTTP request,
   немедленно удаляется из address bar и держится только в памяти формы.
7. Haptics — semantic application port (`selection/success/warning/error/sent`):
   browser adapter использует `navigator.vibrate` только при capability + consent,
   иначе выполняет no-op. UI не обещает прямой iOS Taptic Engine API.
8. Theme `system/light/dark` применяется до interactive render насколько позволяет
   Nuxt bootstrap, сохраняется как несекретная preference и реагирует на system
   color-scheme changes.
9. Motion не блокирует interaction и полностью отключается при
   `prefers-reduced-motion: reduce`.
10. Mobile navigation учитывает safe-area insets; touch targets не меньше 44px;
    desktop layout не превращается в растянутую mobile колонку.
11. Synthetic message codec остаётся явно помеченным как **не E2EE**; visual
    redesign не может создавать ложное ощущение cryptographic readiness.
12. SSR/shared module state не должен смешивать auth между requests. Для
    browser-only local-first/E2EE PWA используется explicit client rendering, а
    state создаётся через Nuxt app-scoped composition.

### План

- [x] Создать frontend domain/application/infrastructure/presentation modules и
  composition root, мигрировать auth contract без cyclic dependencies.
- [x] Сделать `app.vue` тонким, добавить route middleware, layouts и pages:
  `/login`, `/activate`, `/chat`, `/settings`, `/admin/users`.
- [x] Удалить ручной `device_name` input и внедрить typed DeviceInfo port/browser
  adapter с bounded fallback label.
- [x] Добавить ThemePreferences и Haptics ports/adapters, settings state и UI.
- [x] Добавить responsive native shell, desktop rail/mobile tabs, light/dark
  tokens, focus states, restrained transitions и reduced-motion fallback.
- [x] Генерировать invitation URL `/activate#token=...`, копировать его только по
  user gesture и очищать transient secret при уходе со страницы.
- [x] Перенести существующий chat/admin UI на routes без изменения backend API и
  сохранить session-expired/offline behavior.
- [x] Обновить Vitest: auto device label, auth redirects, fragment consumption,
  theme persistence/system changes, haptics capability/no-op и admin visibility.
- [ ] Прогнать ESLint, Vitest, Nuxt typecheck/build и browser QA на mobile/desktop.
- [ ] Проверить production CSP/PWA route fallback и задеплоить отдельным commit.

### Не входит в scope

- admin password reset persistence/API (`BL-039`);
- WebSocket/presence/receipts (`BL-009`, `BL-011`);
- IndexedDB archive/outbox (`BL-022`, `BL-023`);
- cryptographic protocol implementation (`BL-012`–`BL-014`);
- encrypted attachments/push/calls.

### Проверка готовности

- `app.vue` содержит только root layout/page mounting;
- прямые browser/HTTP adapters не импортируются Vue components;
- login request получает автоматически вычисленный bounded device label;
- fragment invite не появляется в server URL, rendered DOM после submit или logs;
- light/dark/system и reduced-motion проверены automated tests;
- unsupported haptics никогда не ломает действие;
- 390px mobile и ≥1280px desktop screenshots не имеют overflow/перекрытий;
- unauthenticated/authenticated/admin route guards работают после reload;
- frontend lint/test/typecheck/build и полный repository CI зелёные.

### Проверено

- старый `services/` удалён; auth/admin/messaging models, ports, use cases,
  runtime parsers и concrete gateways разнесены по слоям, composition выполняет
  один Nuxt plugin;
- `app.vue` содержит только `NuxtLayout/NuxtPage`, пять product routes и три
  guards разделяют guest/auth/admin navigation;
- login UI не принимает device name; `Login` получает label только через
  `DeviceInfoPort`, тест фиксирует `Safari · iOS · Телефон` и bounded fallback;
- system/light/dark и haptics enabled/disabled/unsupported behavior покрыты
  Vitest; send/login/theme используют semantic intents;
- invitation строится как `/activate#token=...`, browser smoke подтверждает
  немедленную очистку URL; BUG-012 исключает echo secret в router warning;
- desktop 1280×720 browser screenshot проверен в light theme без overflow;
- physical 390px screenshot ожидает разблокировки локального Mac; CSS включает
  single-pane conversation/list mode, bottom tabs, 44px targets и safe-area;
- `UV_CACHE_DIR=/tmp/yv-chat-uv-cache make ci`: Ruff/format/import contracts,
  mypy, 120 pytest passed, 6 PostgreSQL tests skipped без `TEST_DATABASE_URL`,
  15 Vitest, ESLint, Nuxt typecheck/build, Compose/deploy checks прошли.
