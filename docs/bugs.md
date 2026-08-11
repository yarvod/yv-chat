# Bugs

Здесь фиксируются воспроизводимые дефекты, найденные во время разработки или проверки. Новые фичи и архитектурные идеи относятся в `backlog.md`, а не сюда.

## Active

Активных известных дефектов нет.

Последняя сверка: `WP-016` — новых открытых воспроизводимых дефектов нет.

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

### BUG-008 — Frontend называл любой неожиданный HTTP error потерей сети

- Статус: `verified`.
- Найдено в: `WP-016`, browser smoke с rejected Origin.
- Severity: `medium`.
- Условия воспроизведения: auth endpoint возвращает 403 или malformed response вместо network exception.
- Ожидаемое поведение: offline UX показывается только при `ApiError.kind=network`; HTTP rejection получает нейтральную retry/error формулировку.
- Фактическое поведение: все ошибки кроме 401 переводили auth state в `offline` и вводили пользователя в заблуждение.
- Причина: первоначальный auth error mapper различал только unauthorized и общий fallback.
- Исправление: network, 401 и прочие HTTP/invalid-response outcomes отображаются раздельно без раскрытия server detail.
- Проверка: Vitest воспроизводит 403 и подтверждает отсутствие сообщения «Сервер недоступен».

### BUG-007 — Frontend bootstrap мог пропустить sync event между snapshot и cursor

- Статус: `verified`.
- Найдено в: `WP-016`, test initial snapshot/cursor ordering.
- Severity: `high`.
- Условия воспроизведения: resource list завершается, затем другой device создаёт сообщение, после чего frontend запрашивает stream cursor и принимает его без применения события.
- Ожидаемое поведение: любое событие либо уже входит в snapshot, либо приходит последующим cursor catch-up.
- Фактическое поведение: первоначальный порядок `snapshot → current cursor` создавал окно для безвозвратно пропущенного события.
- Причина: cursor использовался как отметка после загрузки ресурсов, а не как baseline до snapshot.
- Исправление: startup сначала фиксирует stream cursor, затем получает resource snapshot и poll выполняет catch-up строго после baseline; reset также фиксирует cursor до полного reload.
- Проверка: Vitest проверяет порядок вызовов и получение `message_created` с cursor после baseline.

### BUG-006 — Sync events одного пользователя могли менять причинный порядок

- Статус: `verified`.
- Найдено в: `WP-014`, retention-gap application test.
- Severity: `high`.
- Условия воспроизведения: передать несколько pending events одного user одним append.
- Ожидаемое поведение: cursors сохраняют порядок application operation.
- Фактическое поведение: первоначальная реализация сортировала события по случайному UUID `event_id`.
- Причина: deadlock-safe сортировка recipients ошибочно включала event ID.
- Исправление: user IDs сортируются для стабильного lock order, input order внутри каждого user stream сохраняется.
- Проверка: pagination/retention tests подтверждают cursors `1,2,3` в причинном порядке.

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
