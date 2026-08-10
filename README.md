# yv-chat

Небольшой закрытый self-hosted мессенджер для 10–15 доверенных пользователей.

Проект строится как Nuxt PWA + FastAPI + PostgreSQL и ориентирован на безопасный messaging core: закрытая регистрация, несколько устройств на пользователя, надёжная offline-синхронизация и E2EE без доступа сервера к plaintext сообщений и вложений.

## Статус

Готовы закрытый lifecycle пользователей, device-bound opaque sessions и защищённый FastAPI transport: `__Host-` cookies, exact Origin/CSRF, safe client IP, rotation и logout. Следующий этап — управление активными устройствами.

Текущая фича и подробный план находятся в [docs/workplan.md](docs/workplan.md). Будущие задачи — в [docs/backlog.md](docs/backlog.md), найденные дефекты — в [docs/bugs.md](docs/bugs.md).

## Стек

- Backend: Python 3.13, FastAPI, Pydantic, `uv`.
- Frontend: Nuxt 4, Vue 3, TypeScript, PWA.
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

Backend-команды используют только `uv`; dependency source of truth — `backend/pyproject.toml` и `backend/uv.lock`.

Применить migrations:

```bash
make migrate
```

Первый администратор создаётся ровно один раз. Перед запуском задайте `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_DISPLAY_NAME` и секретный `BOOTSTRAP_ADMIN_PASSWORD` в runtime environment, затем выполните:

```bash
make bootstrap-admin
```

Не храните bootstrap-пароль в репозитории и удалите его из runtime-конфигурации после успешного создания администратора.
