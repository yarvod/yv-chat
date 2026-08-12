# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-061 — Device-bound Web Push notifications

Статус: **in progress**
Backlog: `BL-026`, `BL-027`, MVP slice `BL-028`

Цель: установленная PWA или поддерживаемый browser получает системное уведомление
о новом сообщении в background/closed-tab состоянии, не раскрывая plaintext,
crypto material или session credentials push provider-у.

### Product scope

- [x] настройка показывает platform support и фактический permission/subscription status;
- [x] native permission prompt запускается только явной кнопкой пользователя;
- [x] одна browser installation регистрирует subscription текущего authenticated device;
- [x] changed/expired subscription пере-регистрируется, UI logout удаляет текущую subscription;
- [x] background push показывает generic notification без имени/текста/имени файла;
- [x] click фокусирует существующую PWA либо открывает `/chat?conversation=<id>`;
- [x] foreground visible client не получает лишнюю system notification;
- [x] отправитель не получает push собственного сообщения на своих устройствах;
- [x] unsupported/denied/iOS-not-installed состояния объясняются без бесконечных prompts.

### Backend implementation

- [x] добавить typed push subscription entity/DTO/repository port и отдельную migration;
- [x] endpoint public VAPID configuration и authenticated current-device upsert/delete;
- [x] сервер повторно проверяет ownership текущего `device_id`, endpoint uniqueness и bounds;
- [x] infrastructure adapter использует стандарт Web Push/VAPID и отправляет bounded payload;
- [x] после message commit выполняется best-effort dispatch recipient devices;
- [x] HTTP 404/410 отключает permanent invalid subscription, transient failure только логируется;
- [x] logs содержат только opaque IDs/count/status class, не endpoint/keys/payload content.

### Frontend implementation

- [x] application port/use cases изолируют browser Push API и HTTP subscription API;
- [x] Service Worker обрабатывает `push`/`notificationclick`, dedup по stable `event_id`;
- [x] payload валидируется и содержит только version/event/conversation/message IDs;
- [x] settings card позволяет включить/выключить и восстановить changed subscription;
- [x] CSRF/cookie policy остаётся same-origin; subscription не хранит auth bearer credential;
- [x] install/update/offline shell lifecycle остаётся совместим с существующим Workbox SW.

### Security и correctness invariants

- VAPID private key существует только в runtime secret environment и никогда не попадает
  в Git, image, frontend bundle, API response или logs;
- API отдаёт только public application server key;
- notification payload не содержит plaintext preview, sender name, attachment filename,
  ciphertext, MLS state/key material или device/session credential;
- message и sync events commit выполняются до push; push failure не откатывает message;
- WebSocket, Push и sync остаются wake-up/delivery слоями, PostgreSQL cursor sync — correctness;
- нельзя зарегистрировать subscription на чужой device или удалить чужую subscription.

### Tests и acceptance

- [ ] migration: fresh database → head (GitHub PostgreSQL verify pending);
- [x] backend entity/use-case authorization, bounds, config-route redaction и invalidation tests;
- [x] send-message tests: recipient-only payload, post-commit ordering, failure isolation;
- [x] frontend permission states, application key conversion, subscribe/upsert/delete tests;
- [x] Service Worker push/click/visible-client/dedup tests;
- [x] frontend lint/typecheck/Vitest/build, backend Ruff/mypy/pytest и полный `make ci`;
- [ ] real production subscription и background notification проверены после deploy;
- [ ] production health/logs/nginx и соседние `yoowee.ru`/`s3.yoowee.ru` не нарушены.

### Local acceptance evidence

- backend: `236 passed, 8 skipped`; Ruff format/check, mypy strict и import-linter зелёные;
- frontend: `206 passed` в `41` files; ESLint, Nuxt typecheck и production PWA build зелёные;
- Service Worker build содержит versioned `sw-push.js` в precache и `importScripts`;
- Rust/OpenMLS `21 passed`; full `make ci`, Compose/deploy/docs checks зелёные;
- OpenSSL bootstrap output принят `AppSettings` и `py_vapid` без вывода ключевого материала.

### Exclusions

- plaintext message previews, notification sounds selected by the server и rich media preview;
- conversation mute schedules, app badge/read-state fan-out и notification actions/replies;
- native-like incoming call notifications;
- guaranteed delivery: browser/OS/push service может задержать или отбросить notification.

### Definition of Done

- пользователь явно включает уведомления и видит точный status;
- новый message вызывает privacy-safe system notification в background install;
- click открывает нужный conversation, duplicate event не показывает второй notification;
- revoked/current logout subscription не получает push;
- VAPID secret безопасно установлен в production без чтения/вывода;
- проверки, rollout и production acceptance зелёные, worktree чистый.
