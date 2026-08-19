# yv-chat

Небольшой закрытый self-hosted мессенджер для 10–15 доверенных пользователей.

Проект строится как Nuxt PWA + FastAPI + PostgreSQL и ориентирован на закрытую
регистрацию, несколько устройств на пользователя, надёжную offline-синхронизацию
и E2EE личных диалогов. Группы временно работают без E2EE и явно предупреждают об
этом до повторного включения стабилизированного MLS group lifecycle.

## Статус

Готовы закрытый standalone invitation/registration/session lifecycle, admin user management и
purpose-bound password recovery, authorized direct/group conversations,
ordered/idempotent transport, cursor sync и usable local-first PWA. История,
conversation index и offline outbox хранятся в bounded AES-GCM encrypted IndexedDB.
[ADR-0001](docs/adr/0001-e2ee-mls.md) принял MLS 1.0; `WP-047` внедрил и развернул
server generation/Welcome coordination, Rust/OpenMLS lifecycle и v2 protect/unprotect
через isolated browser Worker. Текущая server-enforced policy: direct — только MLS
v2 без fallback, group — только synthetic v1. Synthetic v1 — UTF-8/base64 transport,
он **не шифрует сообщения и не является E2EE**, поэтому содержимое групп доступно
серверу. Исторические v1/v2 записи не переписываются и читаются своей exact version.
Групповые чаты поддерживают до 10 ordered фото, видео или произвольных файлов на
сообщение: этот поток server-readable, не является E2EE и хранит media не дольше
server TTL. Поддерживаемые видео воспроизводятся внутри PWA, остальные форматы
безопасно скачиваются. Уже открытые group media сохраняются локально в отдельном
AES-GCM encrypted OPFS/IndexedDB cache с LRU ceiling 2 GiB на установку устройства;
browser может предоставить меньше quota или удалить evictable cache. Вложения в
личных MLS-чатах шифруются client-side отдельным random AES-256-GCM key/nonce до
upload; original filename/MIME/kind/size и file key доставляются только внутри MLS
v2 content. Сервер хранит `application/octet-stream` ciphertext и opaque routing
metadata, а расшифровка выполняется локально после authenticated download.
Composer также записывает компактные видеокружки: hold/release отправляет,
swipe-left отменяет, swipe-up фиксирует запись, locked mode позволяет переключить
камеру. Запись ограничена 60 секундами и 8 MiB; bounded target profile использует
720×720, до 30 fps, 900 Kbit/s video и 96 Kbit/s mono speech audio с graceful
camera fallback на поддерживаемые устройством параметры;
по контуру live preview идёт минутный progress ring, а достигший лимита кружок
остаётся в локальном review до явного выбора «Отправить» или «Удалить»;
timeline автоматически воспроизводит muted только реально видимые кружки и ставит
их на pause сразу после выхода за viewport, не накапливая фоновые decoder-ы;
в group v1 это тот же явно server-readable flow, в direct v2 bytes и metadata E2EE;
в обоих случаях это attachment, а не WebRTC call.
Личные чаты поддерживают голосовые 1:1 звонки: authenticated WebSocket переносит
только короткоживущие SDP/ICE signaling frames, а audio идёт напрямую через WebRTC
DTLS-SRTP либо как зашифрованный relay traffic через coturn. FastAPI не получает
audio и не записывает звонки. Интерфейс показывает входящий/исходящий звонок,
accept/reject, mute, duration и hangup; Web Push содержит только generic
`incoming_call` wake-up с opaque IDs. Browser PWA не обещает нативный background
ringing на платформах, где OS не даёт его обычной web-странице.
В Settings можно посмотреть размер и число локальных media-копий и после отдельного
подтверждения очистить только этот кэш: переписки, offline-очередь, session/device
identity и MLS keys не удаляются. `http/https` ссылки в тексте сообщений кликабельны
и открываются обычным browser/OS link handling устройства; unsafe URL schemes inert.
Личные и групповые чаты поддерживают до 50 закреплённых сообщений: direct participant
и group owner/admin могут менять список, обычный group member видит его read-only.
Сервер хранит только opaque references и actor/timestamp; preview личного сообщения
строится после локальной расшифровки, а изменения восстанавливаются через cursor sync.

Действующие group-media лимиты конфигурируемы: фото — 12 MiB, видео — 100 MiB,
произвольный файл — 25 MiB, до 10 вложений на сообщение и 5 GiB активных media
на пользователя. Квота считается по ещё не истёкшим server media, а не как lifetime
лимит. Полностью отключать admission/quota нельзя: deployment рассчитан на небольшой
диск; значения меняются через `MEDIA_*` environment settings в допустимых пределах.

Web Push включается отдельно на каждом устройстве после явного действия пользователя.
Системное уведомление содержит только generic wake-up text, а push payload — opaque
event/conversation/message IDs; имя отправителя и текст сообщения push provider-у не
передаются. На iPhone/iPad уведомления доступны только установленной Home Screen PWA.

Runtime v7 восстанавливает утраченный conversation control-checkpoint по exact
совпадению public local MLS epoch/roster с server generation без logout/login.
Permanent primary device нет: coordinator — временная роль одной MLS generation.
Перед roster epoch advance client последовательно кэширует всю ещё retained
history в encrypted local vault; новые groups также хранят bounded 128
past epochs. Logout/relogin одного device не должен ломать ранее доступную
history другого device.

Install assets адаптированы для Android circle/squircle и Apple Dock. После смены
launcher icon уже установленную Android PWA может потребоваться удалить и установить
заново: Chrome/launcher не гарантируют немедленное обновление install icon.

Текущая фича и подробный план находятся в [docs/workplan.md](docs/workplan.md). Полный продуктовый backlog — в [docs/backlog.md](docs/backlog.md), архитектура и правила её развития — в [docs/architecture.md](docs/architecture.md), найденные дефекты — в [docs/bugs.md](docs/bugs.md).

## Стек

- Backend: Python 3.13, FastAPI, Dishka, Pydantic, `uv`.
- Frontend: Nuxt 4, Vue 3, TypeScript, PWA.
- Client crypto core: Rust 1.91, OpenMLS 0.8.1, WebAssembly.
- Runtime: PostgreSQL, Docker Compose, Nginx.
- Quality: Ruff, mypy, pytest, ESLint, Vitest, Nuxt typecheck.

## Ключевые ограничения

- Сервер не получает plaintext личных E2EE-сообщений, direct-вложений или message
  keys; временные group v1 сообщения и media являются явно документированным
  server-readable исключением без E2EE.
- Публичной регистрации нет: пользователей создаёт администратор.
- Browser auth строится на revocable opaque sessions в `HttpOnly` cookie, а не на токенах в `localStorage`.
- PostgreSQL — источник истины для server sync window; WebSocket служит уведомительным каналом.
- Криптографический протокол не проектируется самостоятельно.
- Для MVP используется один backend, PostgreSQL и локальное media storage за
  `MediaStorage` port без лишних distributed systems; S3 остаётся сменным adapter.

Полные инженерные и security-инварианты закреплены в [AGENTS.md](AGENTS.md).

Production topology, GHCR workflow и безопасный runbook находятся в [docs/deployment.md](docs/deployment.md).

## Локальный запуск

```bash
cp .env.example .env
docker compose -f compose.dev.yml up -d postgres
make backend-install
make frontend-install
```

Запустить в отдельных терминалах:

```bash
make backend-dev
make frontend-dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Healthcheck: `http://localhost:8000/api/v1/health`
- OpenAPI в development: `http://localhost:8000/docs`

Интегрированный локальный HTTP stack:

```bash
docker compose up --build
```

Он доступен на `http://localhost:${YV_CHAT_LOCAL_BIND_PORT:-8080}`; `ALLOWED_ORIGINS`
должен содержать выбранный origin. Это не production deployment с TLS.

## Проверки

```bash
make ci
```

Полный `make ci` также требует pinned Rust toolchain/targets из
`rust-toolchain.toml` и `wasm-bindgen-cli 0.2.127`; он пересобирает versioned browser
crypto package перед frontend tests/build. Public device crypto anchor регистрируется
идемпотентно через `/api/v1/devices/current/crypto-identity`; atomic one-time
KeyPackage inventory/replenishment/claim lifecycle уже реализован. Authenticated
device provisioning использует exact consumer-side OpenMLS validation и пополняет
bounded one-time package pool из того же sealed provider. MLS v2 transport прошёл
two-device browser reload acceptance и production rollout в `WP-047`.
Backend-команды используют только `uv`; Python dependency
source of truth — `backend/pyproject.toml` и `backend/uv.lock`, Rust —
`crypto/Cargo.toml` и `crypto/Cargo.lock`.

Применить migrations:

```bash
make migrate
```

Первый администратор создаётся ровно один раз. Перед запуском задайте `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_DISPLAY_NAME` и секретный `BOOTSTRAP_ADMIN_PASSWORD` в runtime environment, затем выполните:

```bash
make bootstrap-admin
```

Не храните bootstrap-пароль в репозитории и удалите его из runtime-конфигурации после успешного создания администратора.
