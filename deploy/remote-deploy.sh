#!/bin/sh
set -eu

: "${DEPLOY_ROOT:?DEPLOY_ROOT is required}"
: "${BACKEND_IMAGE:?BACKEND_IMAGE is required}"
: "${FRONTEND_IMAGE:?FRONTEND_IMAGE is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${GHCR_USER:?GHCR_USER is required}"

if test -z "${GHCR_TOKEN:-}"; then
    GHCR_TOKEN=$(cat)
fi
: "${GHCR_TOKEN:?GHCR_TOKEN is required through the environment or stdin}"

cd "$DEPLOY_ROOT"
test -f .env
test "$(stat -c '%a' .env)" = "600"
test -f compose.prod.yml
test -f deploy/nginx/gateway.conf

compose() {
    docker compose -p yv-chat --env-file .env -f compose.prod.yml "$@"
}

docker_auth_dir=$(mktemp -d "$DEPLOY_ROOT/.docker-auth.XXXXXX")
cleanup() {
    rm -rf -- "$docker_auth_dir"
}
trap cleanup EXIT HUP INT TERM
chmod 700 "$docker_auth_dir"
export DOCKER_CONFIG="$docker_auth_dir"

printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
unset GHCR_TOKEN

export BACKEND_IMAGE FRONTEND_IMAGE IMAGE_TAG
compose config --quiet
compose pull postgres api frontend gateway
compose up -d --wait postgres
compose run --rm --no-deps api uv run alembic upgrade head

if test -f .bootstrap-admin.env; then
    test "$(stat -c '%a' .bootstrap-admin.env)" = "600"
    compose run --rm --no-deps \
        --env-from-file .bootstrap-admin.env \
        api uv run python -m messenger.bootstrap_admin
    mv .bootstrap-admin.env .initial-admin-credential
    chmod 600 .initial-admin-credential
fi

previous_tag=''
if test -f .deployed-image-tag; then
    previous_tag=$(sed -n '1p' .deployed-image-tag)
fi

if ! compose up -d --wait --wait-timeout 120; then
    if test -n "$previous_tag"; then
        IMAGE_TAG="$previous_tag"
        export IMAGE_TAG
        compose pull api frontend || true
        compose up -d --wait --wait-timeout 120 || true
    fi
    exit 1
fi

printf '%s\n' "$IMAGE_TAG" >.deployed-image-tag
chmod 600 .deployed-image-tag
compose ps
