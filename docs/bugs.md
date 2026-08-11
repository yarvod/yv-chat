# Bugs

Здесь фиксируются воспроизводимые дефекты, найденные во время разработки или проверки. Новые фичи и архитектурные идеи относятся в `backlog.md`, а не сюда.

## Active

Активных известных дефектов нет.

Последняя сверка: `WP-010` — новых открытых воспроизводимых дефектов нет.

## Формат записи

### BUG-NNN — Краткое название

- Статус: `open` / `investigating` / `fixed` / `verified`.
- Найдено в: commit или workplan ID.
- Severity: `critical` / `high` / `medium` / `low`.
- Условия воспроизведения: точные шаги и входные данные.
- Ожидаемое поведение: что должно происходить.
- Фактическое поведение: что происходит.
- Причина: заполняется после диагностики.
- Исправление: commit и краткое описание.
- Проверка: тест или команда, подтверждающая fix.

## Resolved

### BUG-005 — Alembic повторно применял naming convention к имени check constraint

- Статус: `verified`.
- Найдено в: `WP-010`, PostgreSQL upgrade `0006 -> 0007`.
- Severity: `medium`.
- Условия воспроизведения: вызвать `op.drop_constraint` с уже форматированным именем `ck_security_events_event_type_allowed` при активной naming convention.
- Ожидаемое поведение: migration заменяет допустимый набор typed security events.
- Фактическое поведение: Alembic строил несуществующее имя с двойным `ck_security_events_` и транзакционно откатывал migration.
- Причина: существующее физическое имя не было помечено как уже отформатированное convention.
- Исправление: drop/create используют `op.f(...)`, исключая повторное преобразование имени.
- Проверка: `0006↔0007` и чистый `base→head` проходят на PostgreSQL.

### BUG-004 — Healthcheck endpoint обходил versioned API prefix

- Статус: `verified`.
- Найдено в: `WP-005`, проверка HTTP transport contract.
- Severity: `low`.
- Условия воспроизведения: запросить healthcheck и сравнить path с обязательным `/api/v1` prefix.
- Ожидаемое поведение: публичный endpoint доступен как `/api/v1/health`.
- Фактическое поведение: bootstrap endpoint оставался на `/api/health`.
- Причина: healthcheck был создан до фиксации versioned API contract.
- Исправление: router, Compose healthcheck, README и tests переведены на `/api/v1/health`.
- Проверка: HTTP test и OpenAPI image smoke test подтверждают `/api/v1/health`.

### BUG-003 — `uv run` не запускался под непривилегированным пользователем container

- Статус: `verified`.
- Найдено в: `WP-003`, финальный backend image smoke test.
- Severity: `high`.
- Условия воспроизведения: запустить `uv run alembic heads` внутри backend image под настроенным `USER 65532:65532`.
- Ожидаемое поведение: operational `uv run` commands выполняются без root privileges.
- Фактическое поведение: `uv` пытался создать `/.cache/uv` и завершался с `Permission denied`.
- Причина: у numeric runtime user нет домашнего каталога, default cache path оказался недоступен, а обычный `uv run` дополнительно пытался синхронизировать dev dependencies в root-owned `.venv`.
- Исправление: после frozen build-time sync runtime image переключает cache на отдельный `/tmp/uv-runtime-cache` и задаёт `UV_NO_SYNC=1`, используя готовое read-only окружение.
- Проверка: финальный image под `65532:65532` успешно выполняет `uv run alembic heads`.

### BUG-002 — Backend image не содержал Alembic migration environment

- Статус: `verified`.
- Найдено в: `WP-003`, Docker migration smoke test.
- Severity: `high`.
- Условия воспроизведения: собрать backend image и выполнить внутри него `uv run alembic heads` или production migration.
- Ожидаемое поведение: image содержит `alembic.ini` и все migration scripts, поэтому может проверить и применить schema revision.
- Фактическое поведение: runtime image содержал application package, но не Alembic config/migrations.
- Причина: `backend/Dockerfile` копировал только `pyproject.toml`, lockfile и `src/`.
- Исправление: в image явно копируются `alembic.ini` и каталог `migrations/`.
- Проверка: clean backend image успешно выполнил `uv run alembic heads` и показал `0002_account_activation (head)`.

### BUG-001 — Frontend image не собирался из чистого Docker context

- Статус: `verified`.
- Найдено в: `WP-002`, проверка bootstrap Dockerfile.
- Severity: `medium`.
- Условия воспроизведения: выполнить clean `docker build` для `frontend/`.
- Ожидаемое поведение: Nuxt PWA production image успешно собирается.
- Фактическое поведение: generated `.nuxt` types не знали о PWA module, затем typecheck завершался ошибкой.
- Причина: `npm ci` запускал `nuxt prepare` до копирования `nuxt.config.ts` в build stage.
- Исправление: dependency install выполняется с `--ignore-scripts`, затем после `COPY . .` явно запускаются `npm run postinstall` и `npm run build`.
- Проверка: clean `docker build -t yv-chat-frontend:wp002-check frontend` завершён успешно, PWA service worker сгенерирован.
