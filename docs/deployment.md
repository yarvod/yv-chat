# Production deployment

Production target: `chat.yoowee.ru` on `ru1`. The host already runs unrelated services; yv-chat is isolated as Docker Compose project `yv-chat` and must never manage containers, networks or volumes outside that project.

## Topology

```text
Internet
  → host Nginx :443 (TLS; configured separately)
  → 127.0.0.1:18080
  → yv-chat gateway container
      ├→ frontend:3000
      ├→ api:8000 → postgres:5432
      └→ cleanup ─→ postgres:5432
```

Only `127.0.0.1:18080` is published on the host. Gateway joins a small edge network for the host bind and an internal private network; PostgreSQL, API and frontend live only on the private network. Production Compose uses bounded container memory/PID limits because the VPS has about 1.9 GiB RAM and no swap.

The private network uses the project-owned `172.30.242.0/24` subnet and assigns `172.30.242.10` to the gateway. The API trusts only that exact address as a forwarding peer. The subnet was selected after checking the server's existing Docker networks (`172.17.0.0/16` and `172.18.0.0/16`); re-check before moving the stack to another host.

## GitHub configuration

Repository Actions require one secret in the protected `production` environment or repository:

- `DEPLOY_KEY` — private SSH deployment key;
- protected GitHub environment `production` (recommended: required reviewer and deployment branch `main`).

The non-secret target is versioned explicitly as `devuser@chat.yoowee.ru:22`. The server ED25519 host key is pinned in `deploy/ssh_known_hosts`, obtained through the already trusted `ru1` connection. A separate `deployment-config` job validates that `DEPLOY_KEY` exists, parses as a private key and logs in as the expected unprivileged user before image builds begin. Rotate the pinned public host key intentionally if the VPS SSH host identity changes; never replace pinning with `StrictHostKeyChecking=no`.

`GITHUB_TOKEN` publishes and pulls repository-scoped GHCR packages. The deploy job streams it over the authenticated SSH stdin and the remote script uses it through an isolated temporary Docker config, which is removed on exit; it is not placed in an SSH command argument and the server user's persistent Docker credentials are not overwritten.

On push to `main` (or manual dispatch), `.github/workflows/deploy.yml`:

1. runs repository checks;
2. builds backend/frontend images in Actions;
3. pushes `sha-<commit>` and convenience `latest` tags;
4. copies only `compose.prod.yml`, gateway config and remote script;
5. pulls images on the VPS;
6. starts/waits for PostgreSQL;
7. runs `alembic upgrade head` with the new backend image;
8. performs health-checked rollout and records the deployed immutable tag.

The VPS never builds images.

## Server `.env`

The populated file exists only as `/home/devuser/yv-chat/.env`, owner `devuser`, mode `0600`. Start from `.env.production.example`; do not copy a populated file back to the repository or Actions artifacts.

Create the files directly on the server as `devuser`; the script refuses to run as root or overwrite existing credentials:

```bash
cd /home/devuser/yv-chat
chmod 700 deploy/bootstrap-server.sh
./deploy/bootstrap-server.sh
```

It uses `openssl rand` and creates, without printing secret values:

- `.env` — database/runtime configuration, mode `0600`;
- `.bootstrap-admin.env` — one-time initial administrator credential, mode `0600`.

`PASSWORD_RESET_TOKEN_TTL_SECONDS` задаёт отдельный bounded lifetime reset-link
(по умолчанию 3600 секунд) и не влияет на invitation TTL. Старый production
`.env` может не содержать ключ: Compose передаёт безопасный default; при
следующей контролируемой правке файла значение следует добавить явно.

Message retention управляется следующими non-secret settings:

```text
SYNC_EVENT_RETENTION_SECONDS=2592000
MESSAGE_CIPHERTEXT_RETENTION_SECONDS=2592000
MESSAGE_TOMBSTONE_RETENTION_SECONDS=7776000
MESSAGE_CLEANUP_BATCH_SIZE=200
MESSAGE_CLEANUP_INTERVAL_SECONDS=300
```

Tombstone retention обязана быть строго больше и ciphertext TTL, и sync-event
retention; backend fail-fast отклоняет неверную конфигурацию. `cleanup` использует
тот же immutable backend image, private network и PostgreSQL, но отдельный process с
лимитами `96m/64 pids`. У него нет public port и media volume. Остановка worker не
останавливает API, но задерживает scrub до восстановления, поэтому production check
должен считать постоянно restarting/stopped cleanup неисправностью.

The first successful deployment runs the bootstrap command in a one-off backend container and atomically renames the latter file to `.initial-admin-credential`. The deploy script never uses that credential again. Retrieve it over the existing trusted SSH channel, then remove it after the administrator has logged in and changed the password. Do not paste it into an issue, Actions log or chat.

Preflight without exposing values:

```bash
test "$(stat -c '%a' /home/devuser/yv-chat/.env)" = 600
docker compose -p yv-chat \
  --env-file /home/devuser/yv-chat/.env \
  -f /home/devuser/yv-chat/compose.prod.yml config --quiet
```

## First production rollout

Before changing anything, record the non-secret baseline:

```bash
docker compose ls
docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'
ss -lnt
nginx -t
```

Do not read other projects' environment files. The expected pre-rollout state on `ru1` is one unrelated Compose project named `infra`; yv-chat must appear as a second project and must not recreate any `infra-*` container.

After GitHub Actions has published and deployed the immutable images, verify the stack before installing a public vhost:

```bash
cd /home/devuser/yv-chat
docker compose -p yv-chat --env-file .env -f compose.prod.yml ps
curl --fail http://127.0.0.1:18080/healthz
curl --fail http://127.0.0.1:18080/api/v1/health
docker compose -p yv-chat --env-file .env -f compose.prod.yml logs --tail 20 cleanup
```

Cleanup log содержит только batch counts. В нём не должны появляться ciphertext,
message/user IDs, token values или connection strings.

The host Nginx transition has two explicit stages:

```bash
# 1. HTTP-only application/ACME route; existing vhosts are untouched.
install -o root -g root -m 0644 \
  /home/devuser/yv-chat/deploy/nginx/host-chat.http.conf \
  /etc/nginx/conf.d/chat.yoowee.ru.conf
nginx -t
systemctl reload nginx

# 2. Obtain a certificate without letting Certbot rewrite other vhosts.
certbot certonly --webroot -w /var/www/html -d chat.yoowee.ru
certbot certificates

# 3. Install the reviewed HTTPS/redirect/HSTS vhost only after certificate validation.
install -o root -g root -m 0644 \
  /home/devuser/yv-chat/deploy/nginx/host-chat.conf \
  /etc/nginx/conf.d/chat.yoowee.ru.conf
nginx -t
systemctl reload nginx
```

If `nginx -t` fails, do not reload. Restore only `/etc/nginx/conf.d/chat.yoowee.ru.conf` from its immediately preceding version; do not edit or remove neighboring files. The existing host currently reports duplicate `yoowee.ru` warnings from pre-existing `conf.d/esp.conf` and `sites-enabled/yoowee.ru`; they are outside this rollout and must not be silently changed.

Public checks:

```bash
curl --fail --head http://chat.yoowee.ru
curl --fail --head https://chat.yoowee.ru
curl --fail https://chat.yoowee.ru/api/v1/health
```

Repeat the baseline commands and confirm every pre-existing `infra-*` container remains running with the same container ID and start time. Only `yv-chat-*`, its scoped networks and volumes may be new.

## Rollback

The remote script keeps the last successful image tag in `.deployed-image-tag`. If a new health-checked rollout fails, it attempts to start the previous images. Database migrations are intentionally applied before rollout and must remain backward-compatible with the previous application image; migration downgrade is not automatic.

Manual image rollback, scoped to this project only:

```bash
cd /home/devuser/yv-chat
IMAGE_TAG=sha-<known-good-commit> \
docker compose -p yv-chat --env-file .env -f compose.prod.yml up -d --wait
```

Never use `docker system prune`, a broad `docker compose down`, or another project's Compose files during yv-chat deployment.

## Operational checks

```bash
docker compose -p yv-chat --env-file .env -f compose.prod.yml ps
curl --fail http://127.0.0.1:18080/healthz
curl --fail http://127.0.0.1:18080/api/v1/health
```

Host Nginx/TLS setup завершён в `WP-019`. Не публикуйте port `18080` наружу;
HSTS должен оставаться включённым только при исправном certificate/HTTPS route.

## First rollout record

Первый production rollout завершён 2026-08-11 workflow run `31452613018` для
commit `dffae45`:

- SSH preflight, repository verify, backend/frontend GHCR builds и deploy успешны;
- Alembic migrations применены до запуска приложения;
- `postgres`, `api`, `frontend` и `gateway` проекта `yv-chat` healthy;
- единственный published bind проекта — `127.0.0.1:18080`;
- отдельный Nginx vhost прошёл `nginx -t`, HTTP перенаправляет на HTTPS;
- certificate `chat.yoowee.ru` действует до 2026-11-09 и обновляется Certbot;
- публичный PWA и `/api/v1/health` доступны по HTTPS;
- login/`me`/CSRF revoke/logout acceptance выполнен без вывода credential;
- `.env` и `.initial-admin-credential` имеют owner `devuser` и mode `0600`;
- восемь pre-existing `infra-*` containers остались `Up`.

Владелец забирает initial admin credential непосредственно через уже доверенный
SSH-канал. После первого собственного входа и смены пароля файл
`.initial-admin-credential` необходимо удалить с VPS.
