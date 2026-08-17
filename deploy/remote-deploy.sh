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

compose() {
    docker compose -p yv-chat --env-file .env -f compose.prod.yml "$@"
}

docker_auth_dir=$(mktemp -d "$DEPLOY_ROOT/.docker-auth.XXXXXX")
frontend_asset_parent='/var/www/yv-chat'
frontend_asset_current="$frontend_asset_parent/current"
frontend_asset_previous=''
frontend_asset_stage=''
frontend_asset_link_stage=''
temporary_asset_containers=''
nginx_snippet_backup=''
cleanup() {
    for container_id in $temporary_asset_containers; do
        docker rm -f "$container_id" >/dev/null 2>&1 || true
    done
    if test -n "$frontend_asset_stage"; then
        rm -rf -- "$frontend_asset_stage"
    fi
    if test -n "$frontend_asset_link_stage"; then
        rm -f -- "$frontend_asset_link_stage"
    fi
    if test -n "$nginx_snippet_backup"; then
        rm -f -- "$nginx_snippet_backup"
    fi
    rm -rf -- "$docker_auth_dir"
}
trap cleanup EXIT HUP INT TERM
chmod 700 "$docker_auth_dir"
export DOCKER_CONFIG="$docker_auth_dir"

printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
unset GHCR_TOKEN

export BACKEND_IMAGE FRONTEND_IMAGE IMAGE_TAG
compose config --quiet
compose pull postgres api cleanup frontend

prepare_frontend_assets() {
    sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0755 "$frontend_asset_parent"
    frontend_asset_stage=$(mktemp -d "$frontend_asset_parent/release.XXXXXX")

    if test -L "$frontend_asset_current"; then
        previous_name=$(readlink "$frontend_asset_current")
        case "$previous_name" in
            release.*) frontend_asset_previous="$frontend_asset_parent/$previous_name" ;;
            *) echo "Unexpected frontend asset link target" >&2; return 1 ;;
        esac
        test -d "$frontend_asset_previous"
        cp -a "$frontend_asset_previous/." "$frontend_asset_stage/"
    elif test -e "$frontend_asset_current"; then
        echo "Frontend asset path must be a deployment-owned symlink" >&2
        return 1
    fi

    # Copy oldest-to-newest so current unversioned Nuxt metadata wins while the
    # previous two trusted immutable releases remain available to stale PWA shells.
    frontend_images=$(
        docker image ls "$FRONTEND_IMAGE" --format '{{.Repository}}:{{.Tag}}' |
            awk '/:sha-/ && !seen[$0]++ { images[++count] = $0; if (count == 3) exit }
                END { for (index = count; index >= 1; index--) print images[index] }'
    )
    test -n "$frontend_images"
    for frontend_image in $frontend_images; do
        container_id=$(docker create "$frontend_image")
        temporary_asset_containers="$temporary_asset_containers $container_id"
        docker cp "$container_id:/app/.output/public/_nuxt/." "$frontend_asset_stage/"
        docker rm "$container_id" >/dev/null
        temporary_asset_containers=''
    done

    # The release-count bound handles normal cadence; the TTL also prevents files
    # retained from an unusually old local image from accumulating indefinitely.
    find "$frontend_asset_stage" -type f -mtime +7 -delete
    find "$frontend_asset_stage" -type l -delete
    find "$frontend_asset_stage" -mindepth 1 -depth -type d -empty -delete
    chmod -R a+rX "$frontend_asset_stage"
    test -n "$(find "$frontend_asset_stage" -type f -print -quit)"

    frontend_asset_link_stage="$frontend_asset_parent/.current.$$"
    ln -s "$(basename "$frontend_asset_stage")" "$frontend_asset_link_stage"
    mv -Tf "$frontend_asset_link_stage" "$frontend_asset_current"
    frontend_asset_link_stage=''
    frontend_asset_stage=''
}

install_nginx_snippet() {
    nginx_snippet_source="$DEPLOY_ROOT/deploy/nginx/host-chat.server.conf"
    nginx_snippet_target='/etc/nginx/snippets/yv-chat-server.conf'
    test -f "$nginx_snippet_source"
    test -f "$nginx_snippet_target"
    if cmp -s "$nginx_snippet_source" "$nginx_snippet_target"; then
        return
    fi

    nginx_snippet_backup=$(mktemp "$DEPLOY_ROOT/.nginx-snippet.XXXXXX")
    cp "$nginx_snippet_target" "$nginx_snippet_backup"
    sudo install -o root -g root -m 0644 "$nginx_snippet_source" "$nginx_snippet_target"
    if ! sudo nginx -t || ! sudo systemctl reload nginx; then
        sudo install -o root -g root -m 0644 "$nginx_snippet_backup" "$nginx_snippet_target"
        sudo nginx -t
        sudo systemctl reload nginx || true
        return 1
    fi
    rm -f -- "$nginx_snippet_backup"
    nginx_snippet_backup=''
}

prepare_frontend_assets
install_nginx_snippet
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

rollout() {
    # Keep the old frontend serving until the replacement API is healthy. This
    # prevents an auto-updating PWA from reloading into the API recreation window
    # and mistaking a transient 502 for an invalid browser session.
    compose up -d --wait --wait-timeout 120 postgres media-init api cleanup
    curl --fail --silent --show-error \
        "http://127.0.0.1:${YV_CHAT_API_BIND_PORT:-18081}/api/v1/health" >/dev/null
    compose up -d --wait --wait-timeout 120 frontend
}

if ! rollout; then
    if test -n "$previous_tag"; then
        IMAGE_TAG="$previous_tag"
        export IMAGE_TAG
        compose pull api cleanup frontend || true
        rollout || true
    fi
    exit 1
fi

curl --fail --silent --show-error \
    "http://127.0.0.1:${YV_CHAT_FRONTEND_BIND_PORT:-18082}/" >/dev/null

if test -n "$frontend_asset_previous" && test -d "$frontend_asset_previous"; then
    rm -rf -- "$frontend_asset_previous"
fi

printf '%s\n' "$IMAGE_TAG" >.deployed-image-tag
chmod 600 .deployed-image-tag
compose ps
