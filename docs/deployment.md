# Production deployment

Production target: `chat.yoowee.ru` on `ru1`. The VPS also runs unrelated services.
yv-chat is isolated as Docker Compose project `yv-chat` and must never manage
containers, networks, volumes or vhosts belonging to another project.

The chat vhost CSP must retain `script-src 'wasm-unsafe-eval'`: the browser
OpenMLS adapter is WebAssembly. This narrowly enables WASM compilation and must
not be replaced with the broader JavaScript `unsafe-eval`. Without it, public
crypto assets still return HTTP 200 but device provisioning stops before the
`PUT /api/v1/devices/current/crypto-identity` registration request.

## Topology

```text
Internet
  → system Nginx :80/:443 + system Certbot
      ├─ /api/ and /api/v1/realtime → 127.0.0.1:18081 → api:8000
      └─ /                         → 127.0.0.1:18082 → frontend:3000

api ───────────────┐
cleanup ───────────┼→ PostgreSQL on internal private network
                   └→ encrypted media volume (API only)
```

Production has no Nginx container. The Nginx service in root `compose.yml` is only
for local same-origin integration at `http://localhost:8080`.

Only API/frontend loopback ports are published:

- `127.0.0.1:18081` → FastAPI `8000`;
- `127.0.0.1:18082` → Nuxt `3000`.

PostgreSQL and cleanup have no host ports. API joins the project-owned non-internal
`172.30.243.0/24` ingress network and internal `172.30.242.0/24` private network;
frontend joins only ingress, PostgreSQL/cleanup only private. Non-internal ingress is
required for active Docker loopback port publishing in the target runtime. Re-check
both subnets for conflicts before deploying to another host.

Host-to-container traffic was observed from bridge gateway `172.30.243.1`; production
`TRUSTED_PROXY_CIDRS` contains only `172.30.243.1/32`. Client IP, User-Agent and
network changes remain metadata and never revoke an otherwise valid session.

## GitHub configuration

The protected `production` environment/repository contains one secret:

- `DEPLOY_KEY` — private key for unprivileged `devuser@chat.yoowee.ru:22`.

The matching public key belongs in the server user's `authorized_keys`. The server
ED25519 host key is pinned in `deploy/ssh_known_hosts`; never replace pinning with
`StrictHostKeyChecking=no`. `GITHUB_TOKEN` publishes/pulls repository-scoped GHCR
images. The remote script receives it over SSH stdin, uses an isolated temporary
Docker config and removes that config on exit.

On push to `main` or manual dispatch, `.github/workflows/deploy.yml`:

1. runs migration-aware repository verification;
2. builds backend/frontend images in Actions;
3. publishes immutable `sha-<commit>` and convenience `latest` tags;
4. copies the production Compose, deploy scripts and reviewed host vhost sources;
5. starts PostgreSQL and applies Alembic migrations with the new backend image;
6. rolls out API/cleanup/frontend and waits for container health;
7. checks both direct loopback upstreams and records the deployed immutable tag.

The VPS does not build images. Normal application rollout does not reload system
Nginx because its stable loopback upstream addresses do not change.

## Server secrets and non-secret runtime settings

`/home/devuser/yv-chat/.env` exists only on the server, belongs to `devuser` and has
mode `0600`. Never print, copy back or commit it. Initial setup as `devuser`:

```bash
cd /home/devuser/yv-chat
chmod 700 deploy/bootstrap-server.sh
./deploy/bootstrap-server.sh
```

The script uses `openssl rand` without printing values and creates `.env` plus a
one-time `.bootstrap-admin.env`. The first deploy consumes the latter and renames it
to `.initial-admin-credential`; retrieve it over trusted SSH, sign in, change the
password, then delete the file.

Relevant non-secret ingress values are:

```text
ALLOWED_ORIGINS=["https://chat.yoowee.ru"]
TRUSTED_PROXY_CIDRS=["172.30.243.1/32"]
YV_CHAT_API_BIND_PORT=18081
YV_CHAT_FRONTEND_BIND_PORT=18082
```

Do not inspect the rest of `.env` during routine deployment. To validate without
revealing values:

```bash
test "$(stat -c '%a' /home/devuser/yv-chat/.env)" = 600
docker compose -p yv-chat \
  --env-file /home/devuser/yv-chat/.env \
  -f /home/devuser/yv-chat/compose.prod.yml config --quiet
```

Message retention settings and constraints are documented in `.env.example`.
Cleanup uses the same immutable backend image but a separate bounded process; it has
neither a public port nor the media volume.

## Host Nginx ownership

The existing system Nginx is the only public listener on `80/443` and system Certbot
owns the certificate. Versioned source files are:

- `deploy/nginx/host-chat.http.conf` — ACME/bootstrap HTTP route;
- `deploy/nginx/host-chat.conf` — production TLS redirect/proxy/security headers.

The production vhost routes API/WebSocket and frontend separately. It preserves
`Host`, scheme and the forwarding chain; a conditional `Connection` map upgrades
actual WebSocket requests without forcing upgrade semantics on ordinary HTTP.

Never run Certbot/Nginx in the yv-chat production Compose. Never edit neighboring
`yoowee.ru` or `s3.yoowee.ru` vhosts as part of chat deployment.

## Safe vhost change

Record the baseline before any host-level change:

```bash
docker ps --filter name=infra- --format '{{.ID}}|{{.Names}}|{{.Status}}'
ss -lntp
nginx -t
curl --fail http://127.0.0.1:18081/api/v1/health
curl --fail http://127.0.0.1:18082/
```

Install with a unique backup and test before reload:

```bash
cp -p /etc/nginx/conf.d/chat.yoowee.ru.conf \
  /etc/nginx/conf.d/chat.yoowee.ru.conf.before-change
install -o root -g root -m 0644 \
  /home/devuser/yv-chat/deploy/nginx/host-chat.conf \
  /etc/nginx/conf.d/chat.yoowee.ru.conf
nginx -t
systemctl reload nginx
```

After a graceful reload, use a bounded retry: an old worker can briefly serve the
previous upstream. Acceptance must cover both paths and WebSocket routing:

```bash
curl --fail --resolve chat.yoowee.ru:443:127.0.0.1 \
  https://chat.yoowee.ru/api/v1/health
curl --fail --resolve chat.yoowee.ru:443:127.0.0.1 \
  https://chat.yoowee.ru/
curl --http1.1 --include --resolve chat.yoowee.ru:443:127.0.0.1 \
  -H 'Origin: https://chat.yoowee.ru' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://chat.yoowee.ru/api/v1/realtime
```

Without a valid session the last check should reach the application and return
`403`, not gateway `502`.

If acceptance fails, restore only the chat vhost, run `nginx -t`, reload and diagnose
before retrying. Do not touch other vhosts.

## Operational checks

```bash
cd /home/devuser/yv-chat
docker compose -p yv-chat --env-file .env -f compose.prod.yml ps
curl --fail http://127.0.0.1:18081/api/v1/health
curl --fail http://127.0.0.1:18082/
curl --fail https://chat.yoowee.ru/api/v1/health
ss -lntp | grep -E ':(80|443|18081|18082) '
```

Expected state:

- public `80/443` belong only to system Nginx;
- `18081/18082` listen only on `127.0.0.1`;
- no `yv-chat-*` Nginx container and no listener on `18080`;
- yv-chat PostgreSQL/API/frontend healthy and cleanup running;
- neighboring `infra-*` container IDs/statuses remain unchanged.

### Browser TLS failure and VPN/proxy fake IP

Если browser показывает `PR_END_OF_FILE_ERROR`, `ERR_SSL_PROTOCOL_ERROR` или TLS
handshake timeout, отделите origin failure от client network interception:

1. На сервере проверьте `nginx -t`, listener `:443`, SNI certificate и origin health.
2. Сравните public `A/AAAA` с адресом проблемного client. Synthetic адрес из
   `198.18.0.0/15` часто означает fake-IP DNS режима Clash/Mihomo/sing-box и не
   является адресом VPS.
3. Если proxy выдал fake-IP, но не построил tunnel, исправьте domain routing или
   добавьте `chat.yoowee.ru` в direct/fake-IP exclusion на affected device.
4. Очистите client DNS cache/reconnect proxy и повторите HTTPS health.

Нельзя отключать TLS verification, принимать подменный certificate или менять
server certificate ради client-side fake-IP. Docker container/bridge IP — отдельные
внутренние адреса и никогда не должны попадать в public DNS.

## Rollback

The remote script records the last successful tag in `.deployed-image-tag`. Failed
application rollout attempts to restore previous API/cleanup/frontend images.
Migrations must remain backward-compatible because downgrade is not automatic.

Manual image rollback stays scoped to yv-chat:

```bash
cd /home/devuser/yv-chat
IMAGE_TAG=sha-<known-good-commit> \
docker compose -p yv-chat --env-file .env -f compose.prod.yml \
  up -d --wait postgres api cleanup frontend
```

Do not reintroduce the production gateway to rollback an application image. For a
vhost regression restore only its immediate backup. Never use `docker system prune`,
`docker compose down`, `--remove-orphans` or another project's Compose files.

## Rollout records

Initial production rollout completed 2026-08-11 in workflow `31452613018` for
commit `dffae45`: immutable images, migrations, TLS, opaque-session acceptance and
all eight pre-existing `infra-*` containers were verified.

`WP-038` migrated ingress on 2026-08-11 after container
`ca1386492b46` (`yv-chat-gateway-1`) interfered with the shared host ingress:

- API/frontend were first recreated with direct loopback binds and checked before
  Nginx reload;
- system Nginx vhost passed syntax test and public acceptance;
- observed API peer `172.30.243.1` exactly matches trusted `/32`;
- an unauthenticated valid WebSocket upgrade reached FastAPI and returned `403`;
- 40 parallel HTTPS health requests succeeded;
- old gateway was removed only after success;
- `yoowee.ru` remained `301/302`, `s3.yoowee.ru` retained its `403` response, and
  every baseline `infra-*` container kept the same ID and remained `Up`.
