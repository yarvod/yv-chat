# Production deployment

Production origins: `chat.yoowee.ru` and `chat.yoowee.com.de` on `ru1`. The VPS also
runs unrelated services.
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
                   └→ private media volume (API writes/reads, cleanup deletes)
```

Production has no Nginx container. The Nginx service in root `compose.yml` is only
for local same-origin integration at
`http://localhost:${YV_CHAT_LOCAL_BIND_PORT:-8080}`; matching origin must be present
in `ALLOWED_ORIGINS`.

Only API/frontend loopback ports are published:

- `127.0.0.1:18081` → FastAPI `8000`;
- `127.0.0.1:18082` → Nuxt `3000`.

PostgreSQL and cleanup have no host ports. API joins the project-owned non-internal
`172.30.243.0/24` ingress network and internal `172.30.242.0/24` private network;
frontend joins only ingress, PostgreSQL/cleanup only private. Non-internal ingress is
required for active Docker loopback port publishing in the target runtime. Re-check
both subnets for conflicts before deploying to another host.

### coturn для голосовых звонков

WebRTC сначала пробует direct ICE path, но production обязан иметь TURN fallback для
carrier-grade NAT, mobile networks и restrictive Wi-Fi. coturn работает отдельным
root-managed Docker Compose project `yv-chat-coturn`: он не входит в application
Compose, не подключается к PostgreSQL/media volume/application networks и не имеет
доступа к session/VAPID secrets. Образ закреплён immutable digest, host networking
избавляет relay UDP range от Docker NAT, а `64 MiB` limit ограничивает влияние на
маленький VPS.

1. Проверить, что public `3478/udp`, `3478/tcp`, `5349/tcp` и UDP relay range
   `49160:49200` свободны и разрешены provider firewall/security group. Nginx не
   меняется и продолжает единолично владеть `80/443`.
2. Как root скопировать `deploy/coturn` во временный каталог и выполнить:

   ```bash
   TURN_PUBLIC_IP=31.192.110.84 ./install.sh
   ```

   Installer создаёт `/opt/yv-chat-coturn`, генерирует secret без вывода, копирует
   только certificate/key `chat.yoowee.ru` с доступом для container user, атомарно
   добавляет `CALL_*` в `/home/devuser/yv-chat/.env` и запускает отдельный Compose.
3. Installer также ставит root-owned Certbot deploy hook в
   `/etc/letsencrypt/renewal-hooks/deploy/yv-chat-coturn`. Hook реагирует только на
   lineage `chat.yoowee.ru`, обновляет отдельную TLS-копию и перезапускает coturn.
4. Обычным immutable application rollout перезапустить API и проверить authenticated
   `/api/v1/calls/config`: browser должен получить short-lived username/credential,
   но не shared secret.

TURN relay переносит DTLS-SRTP ciphertext и не записывает audio. Nginx не проксирует
TURN: это отдельные UDP/TCP listeners. Если `CALL_TURN_URLS=[]`, UI остаётся доступен,
но звонок за NAT считается best-effort и production acceptance не пройден. Проверка
после rollout выполняется между двумя реальными сетями (например, домашний Wi-Fi и
LTE), затем через browser WebRTC internals подтверждается `relay` candidate pair.

Operational check отдельного сервиса:

```bash
docker compose -p yv-chat-coturn -f /opt/yv-chat-coturn/compose.yml ps
TURN_PUBLIC_IP=31.192.110.84 /opt/yv-chat-coturn/verify.sh
ss -lntup | grep -E ':(3478|5349|4916[0-9]|491[7-9][0-9]|49200) '
docker inspect yv-chat-coturn-coturn-1 --format '{{.HostConfig.Memory}}'
```

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
6. rolls out PostgreSQL/media-init/API/cleanup and waits for container health;
7. validates the pre-provisioned `devuser`-owned `/var/www/yv-chat`, then atomically
   prepares its `current` link from the current and two previous immutable images,
   retaining older files for no more than seven days;
8. checks the direct API loopback, then rolls out the frontend and waits for health;
9. checks the frontend loopback and records the deployed immutable tag.

The VPS does not build images. Normal application rollout does not reload system
Nginx because its stable loopback upstream addresses do not change.
Keeping the previous frontend alive until the replacement API is healthy prevents
an auto-updating PWA from reloading into the expected API recreation/502 window.
Keeping recent content-hashed `/_nuxt` files behind the exact Nginx alias
`/var/www/yv-chat/current` also lets a prompt-mode installed PWA finish running its
previous shell or display the explicit update prompt after rollout. The directory
contains public regular build artifacts only, removes symlinks before publication,
and is bounded by both release count and age. Nginx never exposes the parent as a
generic filesystem root.

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

The same bootstrap generates one P-256 VAPID pair with OpenSSL. `.env` stores
`VAPID_PUBLIC_KEY`, secret `VAPID_PRIVATE_KEY`, `VAPID_CONTACT`, bounded push TTL and
provider timeout. Compose requires all three identity values before API rollout. Never
print or copy the private value; rotating it invalidates existing browser subscriptions,
so rotation requires users to enable notifications again on each device.

Relevant non-secret ingress values are:

```text
ALLOWED_ORIGINS=["https://chat.yoowee.ru","https://chat.yoowee.com.de"]
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
Media defaults are 12 MiB per image, 100 MiB per video, 25 MiB per generic file and
5 GiB active uploader quota; host Nginx keeps `client_max_body_size 150m` above the
largest admitted request. Cleanup uses the same immutable backend image but a
separate bounded process; it has no public port and mounts the media volume only to
delete expired opaque storage keys.

## Host Nginx ownership

The existing system Nginx is the only public listener on `80/443` and system Certbot
owns the certificate. Versioned source files are:

- `deploy/nginx/host-chat.http.conf` — ACME/bootstrap HTTP route;
- `deploy/nginx/host-chat.conf` — production TLS redirect/proxy/security headers.

The production vhost routes API/WebSocket and frontend separately. It preserves
`Host`, scheme and the forwarding chain; a conditional `Connection` map upgrades
actual WebSocket requests without forcing upgrade semantics on ordinary HTTP.
Both production names share one port-80 ACME/redirect server. Each HTTPS name has its
own exact server block and Certbot certificate; both include the project-owned
`/etc/nginx/snippets/yv-chat-server.conf` so security headers, registration rate
limit, API/WebSocket and frontend routing cannot drift. Browser cookies, Service
Worker, IndexedDB and E2EE device state remain origin-scoped: signing in on the
second domain creates a separate browser session/device and does not copy local
crypto state from the first domain.

`Permissions-Policy` allows `camera` and `microphone` only for the top-level
same-origin PWA because group video notes call `getUserMedia` after an explicit user
gesture. Both capabilities remain unavailable to cross-origin content; geolocation
remains disabled. Setting either capture capability to an empty allowlist blocks the
browser permission prompt entirely and must be rejected by `make deploy-check`.

Never run Certbot/Nginx in the yv-chat production Compose. Never edit neighboring
`yoowee.ru` or `s3.yoowee.ru` vhosts as part of chat deployment.

Before enabling cross-release assets, the host administrator creates the public-only
asset parent without granting `devuser` general Nginx/root access:

```bash
install -d -o devuser -g www-data -m 0755 /var/www/yv-chat
```

The normal GitHub deployment has no `sudo`; it fails closed unless this directory
exists and belongs to `devuser`.

When adding or restoring a production name, first install the reviewed dual-name
port-80 chat vhost so its ACME webroot is reachable. Issue each certificate through
the existing webroot without letting Certbot rewrite Nginx configs:

```bash
certbot certonly --webroot --webroot-path /var/www/html \
  --cert-name chat.yoowee.ru --non-interactive -d chat.yoowee.ru
certbot certonly --webroot --webroot-path /var/www/html \
  --cert-name chat.yoowee.com.de --non-interactive -d chat.yoowee.com.de
certbot certificates
nginx -t
systemctl reload nginx
```

Each resulting renewal file must contain only its own domain and the `webroot`
authenticator. A combined SAN lineage couples renewal availability and is not the
steady-state configuration.

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
install -o root -g root -m 0644 \
  /home/devuser/yv-chat/deploy/nginx/host-chat.server.conf \
  /etc/nginx/snippets/yv-chat-server.conf
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
curl --fail --resolve chat.yoowee.com.de:443:127.0.0.1 \
  https://chat.yoowee.com.de/api/v1/health
curl --fail --resolve chat.yoowee.com.de:443:127.0.0.1 \
  https://chat.yoowee.com.de/
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
