# Production deployment

Production target: `chat.yoowee.ru` on `ru1`. The host already runs unrelated services; yv-chat is isolated as Docker Compose project `yv-chat` and must never manage containers, networks or volumes outside that project.

## Topology

```text
Internet
  → host Nginx :443 (TLS; configured separately)
  → 127.0.0.1:18080
  → yv-chat gateway container
      ├→ frontend:3000
      └→ api:8000 → postgres:5432
```

Only `127.0.0.1:18080` is published on the host. Gateway joins a small edge network for the host bind and an internal private network; PostgreSQL, API and frontend live only on the private network. Production Compose uses bounded container memory/PID limits because the VPS has about 1.9 GiB RAM and no swap.

## GitHub configuration

Repository Actions require:

- `DEPLOY_HOST` — server hostname/address;
- `DEPLOY_USER` — `devuser`;
- `DEPLOY_KEY` — private SSH deployment key;
- optional `DEPLOY_PORT`, default `22`;
- protected GitHub environment `production` (recommended: required reviewer and deployment branch `main`).

`GITHUB_TOKEN` publishes and pulls repository-scoped GHCR packages. It is passed to the remote step as a masked value and used through an isolated temporary Docker config, which is removed on exit; the server user's persistent Docker credentials are not overwritten.

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

Generate the database password directly on the server:

```bash
openssl rand -hex 32
```

Use the same hex value in `POSTGRES_PASSWORD` and the password component of `DATABASE_URL`. Hex avoids URL-encoding ambiguity. Remove `BOOTSTRAP_ADMIN_*` after the initial administrator has been created.

Preflight without exposing values:

```bash
test "$(stat -c '%a' /home/devuser/yv-chat/.env)" = 600
docker compose -p yv-chat \
  --env-file /home/devuser/yv-chat/.env \
  -f /home/devuser/yv-chat/compose.prod.yml config --quiet
```

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

Host Nginx/TLS setup and public HTTPS verification are the next workplan. Do not expose port `18080` publicly and do not enable HSTS until the certificate/domain route is verified.
