# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-018 — Production Compose, GHCR и deploy workflow

Статус: **completed**
Backlog item: `BL-030`
Цель: собирать immutable backend/frontend images в GitHub Actions и безопасно разворачивать отдельный stack на `ru1`, не затрагивая существующие сервисы.

### Результат

`compose.prod.yml` запускает PostgreSQL, API, Nuxt и internal Nginx gateway как project `yv-chat`; наружу host публикуется только `127.0.0.1:18080`. `deploy.yml` после CI строит/push immutable GHCR images, копирует только versioned deploy artifacts, выполняет migration и health-checked rollout по SSH.

### Invariants

1. Production server ничего не собирает; он только pulls GHCR images.
2. Image tag immutable `sha-<commit>`; `latest` только convenience, rollout его не использует.
3. Stack всегда запускается с explicit project `yv-chat`; чужие containers/networks/volumes не перечисляются и не удаляются.
4. Только gateway имеет host bind `127.0.0.1:18080`; PostgreSQL/API/frontend не публикуют ports.
5. `.env` не копируется из repository/workflow и должен существовать на server с mode `0600`.
6. Workflow не печатает runtime secret values; GHCR credential подаётся через masked secret.
7. Compose config fail-fast требует production DB credentials, exact HTTPS origin и image coordinates.
8. Migration выполняется явно новым backend image до rollout; migrations backward-compatible с текущим app.
9. Healthchecks обязательны; failed rollout не меняет соседние Compose projects.
10. No `docker system prune`, broad cleanup или unscoped `--remove-orphans`.
11. Resource limits учитывают VPS с 1.9 GiB RAM и отсутствие swap.
12. Deployment environment защищается GitHub `production` environment/concurrency.

### План

- [x] Добавить isolated `compose.prod.yml` с pinned images, volumes, healthchecks и limits.
- [x] Добавить internal gateway config для `/api/` и PWA.
- [x] Добавить remote deploy script с preflight, pull, migration, rollout и status.
- [x] Добавить `.github/workflows/deploy.yml` для verify/build/push/copy/SSH deploy.
- [x] Добавить `.env.production.example` без реальных secrets и production runbook.
- [x] Добавить Compose/render/script static tests.
- [x] Локально проверить config, images, migration и health smoke.
- [x] Обновить docs и создать отдельный commit.

### Не входит в scope

- изменение host Nginx/TLS (`WP-019`, `BL-029`);
- запись production `.env`/первый production rollout;
- backup/restore (`BL-031`);
- real E2EE.

### Проверка готовности

- `docker compose -p yv-chat --env-file test.env -f compose.prod.yml config` проходит;
- опубликован ровно `127.0.0.1:18080`, Postgres извне недоступен;
- workflow deploy uses commit SHA images and production environment;
- remote script не содержит unscoped destructive operations;
- local production-like migration/health smoke зелёный;
- полный CI зелёный и отдельный commit создан.

### Проверено

- portable YAML parse для CI/deploy/production Compose;
- `make compose-check deploy-check` и полный `make ci`;
- local `make ci`: 120 pytest passed, 6 PostgreSQL tests skipped без `TEST_DATABASE_URL`, 11 Vitest; GitHub deploy verify явно поднимает PostgreSQL и задаёт integration URL;
- clean production-tagged backend/frontend Docker builds;
- fresh PostgreSQL `base → 0010`, production settings и disabled direct API schema;
- all four healthchecks, PWA/API HTTP through gateway;
- `ps`: только gateway публикует `127.0.0.1:18082->80`, остальные ports internal;
- временный production-like project и volumes удалены после smoke.
