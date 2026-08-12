# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-067 — Safe iOS PWA crypto re-enrollment

Статус: **implemented and verified locally**

Цель: Home Screen PWA, получившая скопированную Safari auth-cookie без Safari
IndexedDB/MLS state, безопасно становится отдельным device без logout/revoke
здоровой Safari-сессии.

### Reproduction

- iOS 17.2+ при Add to Home Screen копирует first-party auth cookies, но не
  IndexedDB;
- PWA обращается к server под существующим `device_id`, получает уже
  зарегистрированную crypto identity и обязана выполнить local restore;
- отдельный PWA storage не содержит `yv-chat-crypto-v1`, поэтому restore
  fail-closed возвращает `not-provisioned`, хотя Safari под той же исходной
  session продолжает расшифровывать сообщения;
- обычный logout отзовёт shared server session и ухудшит recovery.

### Scope

- [x] явный password-confirmed re-enrollment создаёт новую device/session через
  существующий login boundary и заменяет cookie только текущего Web App container;
- [x] старый server device/session не отзывается автоматически;
- [x] пароль очищается из component state сразу после submit и никогда не
  сохраняется/логируется;
- [x] новый `device_id` автоматически запускает обычный provision/KeyPackage flow;
- [x] browser best-effort запрашивает persistent origin storage без удаления или
  миграции существующих IndexedDB;
- [x] UI объясняет, что Safari и PWA являются разными E2EE devices.

### Security invariants

- silent identity replacement под прежним `device_id` запрещён;
- re-enrollment требует действующий account password;
- Safari private MLS state не копируется через server;
- ошибочный пароль не завершает действующую session и не скрывает authenticated UI;
- никакого v1 fallback для direct conversation нет.

### Exclusions

- перенос старой истории/MLS epochs между devices — `BL-015`/`BL-064`;
- автоматический server-side backup private keys;
- изменение MLS protocol framing или crypto vault schema;
- гарантия platform storage persistence, которую браузер может отклонить.

### Definition of Done

- registered identity + missing local vault открывает password re-enrollment UI;
- successful confirmation возвращает другой `device_id`, сохраняет старую session
  active и запускает crypto initialization нового device;
- failed confirmation оставляет current account/session неизменными;
- component test доказывает немедленную очистку password;
- persistence adapter корректно обрабатывает granted/denied/unsupported;
- frontend lint/typecheck/tests/build и полный `make ci` проходят.

### Verification evidence

- frontend ESLint, Nuxt typecheck, production PWA build и `42` files / `226` tests:
  green;
- backend `238 passed, 9 skipped`; повторный HTTP login явно создаёт другой
  session/device и оставляет первый device/session non-revoked;
- Rust/OpenMLS `21` tests, native/wasm clippy и repository `make ci`: green;
- production iPhone Safari/PWA acceptance выполняется после rollout.
