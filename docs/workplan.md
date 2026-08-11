# Workplan

Этот файл содержит только одну текущую фичу. Перед началом следующей фичи завершённая работа фиксируется коммитом, а новый пункт переносится сюда из `backlog.md`.

## WP-019 — Первый production rollout, host Nginx и TLS

Статус: **in progress**
Backlog item: `BL-029`
Цель: развернуть проверенный messaging MVP на `chat.yoowee.ru` через изолированный Compose project `yv-chat`, подключить его к существующему host Nginx и подтвердить, что соседние сервисы на `ru1` не изменились.

### Результат

GitHub Actions публикует immutable backend/frontend images и выкатывает их в `/home/devuser/yv-chat`; server-only `.env` создан непосредственно на VPS с mode `0600`. Host Nginx проксирует только `chat.yoowee.ru` в loopback gateway `127.0.0.1:18080`, HTTPS-сертификат валиден, HTTP перенаправляет на HTTPS, а public API/PWA проходят smoke-проверку без изменения чужих containers, ports и virtual hosts.

### Invariants

1. До rollout снимается и сохраняется только несекретный baseline существующих Compose projects, container names/status, listeners и Nginx virtual hosts.
2. Не читаются и не копируются `.env`, credentials или private keys соседних сервисов.
3. Production secrets генерируются непосредственно на `ru1`; их значения не попадают в terminal output, logs, Git, Actions artifacts или документацию.
4. `/home/devuser/yv-chat/.env` принадлежит `devuser` и имеет mode `0600`.
5. Stack использует только explicit Compose project `yv-chat`; запрещены broad `down`, `--remove-orphans`, `system prune` и операции над чужими resources.
6. Единственный host bind stack — `127.0.0.1:18080`; PostgreSQL/API/frontend не публикуются наружу.
7. Перед изменением host Nginx новый stack обязан пройти loopback health/API smoke.
8. Nginx-конфиг добавляется отдельным server block для exact `chat.yoowee.ru`; существующие конфиги не переписываются.
9. Конфиг проверяется `nginx -t` до reload; reload выполняется только после успешной проверки.
10. HSTS включается только после подтверждения валидного HTTPS и корректного redirect.
11. WebSocket upgrade/timeouts, request body limit и trusted proxy boundary согласованы с backend/ingress.
12. После rollout сравнивается baseline: соседние container names/status/listeners остаются неизменными.
13. Первая admin credential хранится только как одноразовый server-side файл mode `0600`; после передачи администратору bootstrap env удаляется из `.env`.
14. Если GitHub Actions/SSH/sudo prerequisite отсутствует, rollout останавливается до privileged mutation; работоспособные соседние сервисы имеют приоритет.

### План

- [ ] Проверить local branch/remote, GitHub Actions prerequisites и наличие deployment secret names без чтения значений (local/remote проверены; фактические secrets подтвердит workflow).
- [x] Снять read-only production baseline: Docker projects/containers, listeners, Nginx config и текущие public endpoints.
- [x] Добавить отдельный versioned host Nginx template с HTTP challenge/redirect и HTTPS reverse proxy.
- [x] Добавить безопасный server bootstrap script: создать `.env`/bootstrap credential без вывода secret values и проверить permissions.
- [x] Дополнить deployment runbook first-run, TLS, rollback и post-deploy comparison.
- [x] Прогнать repository CI и deploy static checks; окончательный Nginx syntax test выполнить с issued certificate до reload.
- [ ] Опубликовать feature branch и пропустить изменения через GitHub CI до `main`.
- [ ] Создать server-only secrets и deploy directory; не изменять host Nginx до loopback smoke.
- [ ] Выполнить immutable Compose rollout, migration и loopback health/API/PWA smoke.
- [ ] Установить отдельный Nginx vhost, получить certificate, проверить config и reload.
- [ ] Проверить public HTTPS/redirect/security headers и основной onboarding/login flow.
- [ ] Сравнить соседние services с baseline, зафиксировать результат в docs и отдельном commit.

### Не входит в scope

- real E2EE (`BL-012`–`BL-014`): текущий synthetic envelope остаётся явно non-secure;
- attachment storage/upload (`BL-016`, `BL-017`);
- backup/restore (`BL-031`);
- WebSocket notifications (`BL-011`);
- изменение или перезапуск существующих unrelated services на `ru1`.

### Проверка готовности

- GitHub verify/build/deploy jobs зелёные для immutable commit tag;
- `docker compose -p yv-chat ... ps` показывает четыре healthy services;
- на host опубликован только `127.0.0.1:18080`, порт PostgreSQL отсутствует в public listeners;
- `curl http://127.0.0.1:18080/healthz` и `/api/v1/health` успешны;
- `http://chat.yoowee.ru` перенаправляет на валидный `https://chat.yoowee.ru`;
- PWA/API работают через HTTPS, browser console не содержит runtime errors;
- Nginx передаёт trusted proxy headers и WebSocket upgrade, security headers присутствуют;
- baseline diff не показывает stopped/recreated/renamed unrelated containers или потерянные listeners;
- `.env` и bootstrap credential имеют mode `0600`, secret scan Git/workflow artifacts чистый;
- полный repository CI проходит, docs обновлены и feature завершена отдельным commit.

### Проверено

- local branch `codex/bootstrap-and-workflow` линейно опережает `origin/main`; worktree до WP-019 был чистым;
- root read-only audit: один Compose project `infra`/8 running containers, Docker subnets `172.17.0.0/16` и `172.18.0.0/16`, port `18080` свободен;
- `nginx -T` успешен с двумя pre-existing duplicate `yoowee.ru` warnings; существующие configs не изменены;
- Certbot установлен, действующие соседние certificates не читались глубже public metadata;
- bootstrap-script в isolated temp directory создал только ожидаемые variables и оба файла mode `0600`, secret values не выводились;
- production `.env` и `.bootstrap-admin.env` созданы непосредственно на `ru1` как `devuser:devuser`, mode `0600`; содержимое не читалось;
- `make ci` с isolated `UV_CACHE_DIR`: 120 pytest passed, 6 PostgreSQL integration tests skipped без local `TEST_DATABASE_URL`, 11 Vitest; Ruff/format/import contracts/mypy/ESLint/Nuxt typecheck/build/Compose/deploy checks прошли.
- первый production workflow `31451233832` безопасно остановился на verify до build/deploy; BUG-010 локализован как отсутствующий Alembic upgrade для fresh verification DB и исправлен отдельным migration step.
