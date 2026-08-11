# Bugs

Здесь фиксируются воспроизводимые дефекты, найденные во время разработки или проверки. Новые фичи и архитектурные идеи относятся в `backlog.md`, а не сюда.

## Active

Активных воспроизводимых дефектов нет.

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

### BUG-011 — Appleboy SCP transport завершался до remote deploy без диагностируемой причины

- Статус: `verified`.
- Найдено в: `WP-019`, GitHub Actions run `31451487597` для `a06e056`.
- Severity: `high`.
- Условия воспроизведения: verify и оба GHCR build jobs зелёные, затем `appleboy/scp-action@v1` завершается exit code 1 до появления versioned artifacts на VPS.
- Ожидаемое поведение: SSH readiness проверяется до resource-heavy builds, artifacts копируются через pinned host identity, затем запускается remote deploy.
- Фактическое поведение: opaque action annotation не показывала публично ничего кроме exit code; remote script не запускался, server stack не менялся.
- Причина: transport boundary не имел отдельного проверяемого SSH preflight и полагался на opaque third-party SCP action; после его замены диагностика также выявила неверный `DEPLOY_KEY` fingerprint.
- Исправление: non-secret target зафиксирован как `devuser@chat.yoowee.ru:22`, host ED25519 key pinned; отдельный job проверяет `DEPLOY_KEY`/SSH до build, а deploy использует native `ssh/scp` и передаёт GHCR token только через stdin.
- Проверка: production workflow `31452613018` прошёл `deployment-config`, artifact copy, remote migration и health-checked rollout; четыре `yv-chat-*` containers healthy, public HTTPS API отвечает.

### BUG-010 — Deploy verify запускал PostgreSQL integration tests без schema

- Статус: `verified`.
- Найдено в: `WP-019`, GitHub Actions run `31451233832` для `c12d94d`.
- Severity: `high`.
- Условия воспроизведения: push в `main` поднимает свежий PostgreSQL service, задаёт `TEST_DATABASE_URL` и запускает `make ci` без предварительного Alembic upgrade.
- Ожидаемое поведение: deploy verify повторяет backend CI и выполняет все PostgreSQL integration tests против актуальной schema.
- Фактическое поведение: обычные backend/frontend/compose CI jobs были зелёными, а deploy `verify` падал на шаге `make ci`; build/deploy корректно оставались skipped.
- Причина: отдельный backend CI применял `uv run alembic upgrade head`, а агрегированный deploy verify пропустил этот шаг для своей независимой fresh database.
- Исправление: deploy workflow явно применяет Alembic migrations после frozen dependency install и до `make ci`.
- Проверка: local workflow/YAML checks и повторный production workflow должны показать зелёные verify/integration tests перед build/deploy.

### BUG-009 — Gateway loopback port не активировался на internal-only network

- Статус: `verified`.
- Найдено в: `WP-018`, production-like Docker smoke.
- Severity: `critical`.
- Условия воспроизведения: gateway подключён только к Compose network с `internal: true`, хотя `HostConfig.PortBindings` содержит `127.0.0.1:18082`.
- Ожидаемое поведение: host loopback принимает HTTP и только gateway имеет published port.
- Фактическое поведение: container был healthy, но Docker не создавал активный `NetworkSettings.Ports` binding; host curl получал connection refused.
- Причина: internal-only network не предоставляла gateway edge path для published port в проверяемом Docker runtime.
- Исправление: gateway подключён к отдельной non-internal edge network и одновременно к internal private network; остальные services остаются только private.
- Проверка: production Compose `ps` показывает `127.0.0.1:18082->80/tcp`, оба health endpoints отвечают, API/frontend/PostgreSQL ports не опубликованы.

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
