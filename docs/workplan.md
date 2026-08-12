# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи
завершённая работа фиксируется отдельным коммитом, а новый пункт переносится
сюда из `backlog.md`.

## WP-054 — Self-healing MLS checkpoint для нескольких устройств

Статус: **completed**
Backlog: `BL-054`
Bug: `BUG-053`

Цель: убрать необходимость logout/login после deploy/reload, когда sealed OpenMLS
state устройства сохранён, но отдельный conversation control-checkpoint в IndexedDB
утрачен или отстал. Постоянного primary device не вводить: coordinator остаётся
временной ролью одной server generation.

### Scope и security contract

- [x] Rust/OpenMLS adapter выдаёт только public локальный conversation summary:
  epoch и canonical device roster; private keys, tree secrets и wire state наружу
  не выходят.
- [x] Worker/application boundary предоставляет typed read-only
  `inspectConversation`; операция не мутирует ratchet и не создаёт checkpoint.
- [x] Reconciliation при отсутствующем control-checkpoint запрашивает ordered READY
  generations и восстанавливает checkpoint только при точном совпадении
  conversation, epoch и полного device roster.
- [x] После найденного checkpoint клиент применяет последующие Commit/Welcome в
  обычном порядке и продолжает отправку без logout/login.
- [x] Если sealed MLS group действительно отсутствует либо не соответствует ни одной
  доступной generation, direct chat остаётся fail-closed и показывает явную потерю
  локального E2EE state вместо generic network/server ошибки.
- [x] Никакой synthetic-v1 fallback, копирования private keys через сервер,
  автоматической смены device identity или permanent primary device не добавляется.

### Tests и acceptance

- [x] Rust tests: missing group, exact epoch/roster inspection, canonical ordering.
- [x] Worker/runtime tests: strict request/result parsing, missing/existing group и
  отсутствие crypto mutation/checkpoint у inspect.
- [x] Reconciliation regression: control DB очищена, sealed OpenMLS state сохранён;
  exact generation восстанавливается и следующие commits догоняются.
- [x] Negative tests: epoch/roster mismatch и полная потеря group state не создают
  ложный READY checkpoint и не разрешают send.
- [x] Frontend lint/typecheck/Vitest, Rust fmt/clippy/tests и полный `make ci` зелёные.
- [x] Production rollout публикует runtime v7; exact non-coordinator partial-loss
  regression выполнен real WASM/Worker tests без logout/login, public asset/API,
  API health/logs и отсутствие влияния на соседние host services.

### Ограничения

- этот slice не переносит старую локальную историю и private MLS state на физически
  новое устройство;
- если browser действительно удалил sealed crypto vault, безопасное re-enrollment
  новой device identity остаётся отдельным явным flow и не может восстановить старую
  историю без device-to-device archive transfer;
- coordinator generation не становится account-level primary и не требует ручной
  передачи при logout.

### Definition of Done

- deploy/reload и потеря только conversation checkpoint самовосстанавливаются;
- полная потеря keys диагностируется отдельно и fail-closed;
- multi-device продолжает работать без постоянного primary device;
- tests, docs, focused commit и production verification завершены.

Production verification: GitHub Actions CI `31549397608` и deploy
`31549397629` успешно выпустили immutable release
`sha-01ef0acf9fa548b498b7ef8c9209f85c7860f8f2`. API/frontend containers healthy,
PostgreSQL не пересоздавался, `/api/v1/health` и `/crypto/v7/...wasm` отвечают 200
с валидным TLS, свежие API logs не содержат `ERROR`/`Traceback`/5xx. Соседние
`yoowee.ru`/`s3.yoowee.ru` сохранили ожидаемые ответы. Physical affected-device
confirmation выполняется пользователем после automatic PWA update; logout для него
не требуется.
