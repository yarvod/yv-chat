# yv-chat

Небольшой закрытый self-hosted мессенджер для 10–15 доверенных пользователей.

Проект строится как Nuxt PWA + FastAPI + PostgreSQL и ориентирован на безопасный messaging core: закрытая регистрация, несколько устройств на пользователя, надёжная offline-синхронизация и E2EE без доступа сервера к plaintext сообщений и вложений.

## Статус

Готовы закрытый invitation/activation/session lifecycle, admin user management и purpose-bound password recovery, authorized direct/group conversations, ordered/idempotent message transport, durable per-user cursor sync и usable PWA для обмена сообщениями. История открывается с bounded latest page, догружается назад и сохраняет transport envelopes в AES-GCM encrypted IndexedDB archive; список чатов, directory, receipts и sync cursor открываются из отдельного encrypted snapshot до network catch-up. Offline outbox ещё не завершён. [ADR-0001](docs/adr/0001-e2ee-mls.md) принял MLS 1.0 и threat model; repository воспроизводимо собирает pinned OpenMLS WASM, изолирует его в Worker и хранит private state только как WebCrypto-sealed IndexedDB record. Server identity registry, MLS group lifecycle и остальные implementation release gates ещё не выполнены. Текущий synthetic client codec предназначен только для MVP-проверки транспорта, **не шифрует сообщения и не является E2EE**; интерфейс явно предупреждает об этом.

Install assets адаптированы для Android circle/squircle и Apple Dock. После смены
launcher icon уже установленную Android PWA может потребоваться удалить и установить
заново: Chrome/launcher не гарантируют немедленное обновление install icon.

Текущая фича и подробный план находятся в [docs/workplan.md](docs/workplan.md). Полный продуктовый backlog — в [docs/backlog.md](docs/backlog.md), архитектура и правила её развития — в [docs/architecture.md](docs/architecture.md), найденные дефекты — в [docs/bugs.md](docs/bugs.md).

## Стек

- Backend: Python 3.13, FastAPI, Dishka, Pydantic, `uv`.
- Frontend: Nuxt 4, Vue 3, TypeScript, PWA.
- Client crypto core: Rust 1.91, OpenMLS 0.8.1, WebAssembly (release-gated).
- Runtime: PostgreSQL, Docker Compose, Nginx.
- Quality: Ruff, mypy, pytest, ESLint, Vitest, Nuxt typecheck.

## Ключевые ограничения

- Сервер не хранит plaintext сообщений, вложений или message keys.
- Публичной регистрации нет: пользователей создаёт администратор.
- Browser auth строится на revocable opaque sessions в `HttpOnly` cookie, а не на токенах в `localStorage`.
- PostgreSQL — источник истины для server sync window; WebSocket служит уведомительным каналом.
- Криптографический протокол не проектируется самостоятельно.
- Для MVP используется один backend, PostgreSQL и локальное encrypted media storage без лишних distributed systems.

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

Он доступен на `http://localhost:8080` и не является production deployment с TLS.

## Проверки

```bash
make ci
```

Полный `make ci` также требует pinned Rust toolchain/targets из
`rust-toolchain.toml` и `wasm-bindgen-cli 0.2.127`; он пересобирает versioned browser
crypto package перед frontend tests/build. Public device crypto anchor регистрируется
идемпотентно через `/api/v1/devices/current/crypto-identity`; atomic one-time
KeyPackage inventory/replenishment/claim lifecycle уже реализован. Automatic
provisioning остаётся выключен до consumer-side OpenMLS validation и завершения MLS
group/Welcome lifecycle. Backend-команды используют
только `uv`; Python dependency
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
