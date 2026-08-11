#!/bin/sh
set -eu

deploy_root=${DEPLOY_ROOT:-/home/devuser/yv-chat}

if test "$(id -u)" = "0"; then
    echo "Run this script as the deployment user, not root." >&2
    exit 1
fi

command -v openssl >/dev/null
test -d "$deploy_root"
test ! -e "$deploy_root/.env"
test ! -e "$deploy_root/.bootstrap-admin.env"
test ! -e "$deploy_root/.initial-admin-credential"

umask 077
env_tmp=$(mktemp "$deploy_root/.env.tmp.XXXXXX")
bootstrap_tmp=$(mktemp "$deploy_root/.bootstrap-admin.tmp.XXXXXX")
cleanup() {
    rm -f -- "$env_tmp" "$bootstrap_tmp"
}
trap cleanup EXIT HUP INT TERM

database_password=$(openssl rand -hex 32)
admin_password=$(openssl rand -hex 24)

printf '%s\n' \
    'POSTGRES_DB=yv_chat' \
    'POSTGRES_USER=yv_chat' \
    "POSTGRES_PASSWORD=$database_password" \
    "DATABASE_URL=postgresql+asyncpg://yv_chat:$database_password@postgres:5432/yv_chat" \
    'ALLOWED_ORIGINS=["https://chat.yoowee.ru"]' \
    'TRUSTED_PROXY_CIDRS=["172.30.242.10/32"]' \
    'YV_CHAT_BIND_PORT=18080' \
    'ACTIVATION_TOKEN_TTL_SECONDS=86400' \
    'SESSION_IDLE_TIMEOUT_SECONDS=2592000' \
    'SESSION_ABSOLUTE_LIFETIME_SECONDS=7776000' \
    'SESSION_ROTATION_INTERVAL_SECONDS=86400' \
    'SESSION_PREVIOUS_TOKEN_GRACE_SECONDS=60' \
    'SESSION_TOUCH_INTERVAL_SECONDS=300' \
    'SECURITY_EVENT_RETENTION_SECONDS=7776000' >"$env_tmp"

printf '%s\n' \
    'BOOTSTRAP_ADMIN_USERNAME=admin' \
    'BOOTSTRAP_ADMIN_DISPLAY_NAME=Administrator' \
    "BOOTSTRAP_ADMIN_PASSWORD=$admin_password" >"$bootstrap_tmp"

chmod 600 "$env_tmp" "$bootstrap_tmp"
mv "$env_tmp" "$deploy_root/.env"
mv "$bootstrap_tmp" "$deploy_root/.bootstrap-admin.env"
unset database_password admin_password
trap - EXIT HUP INT TERM

echo "Created production .env and one-time admin credential with mode 0600."
echo "Secret values were not printed."
