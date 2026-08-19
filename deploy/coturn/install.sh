#!/bin/sh
set -eu

: "${TURN_PUBLIC_IP:?TURN_PUBLIC_IP is required}"

SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${TURN_INSTALL_DIR:-/opt/yv-chat-coturn}
APP_ENV=${YV_CHAT_ENV:-/home/devuser/yv-chat/.env}
CERT_LINEAGE=${TURN_CERT_LINEAGE:-/etc/letsencrypt/live/chat.yoowee.ru}

if test "$(id -u)" -ne 0; then
    echo "coturn installation must run as root" >&2
    exit 1
fi

test -f "$APP_ENV"
test "$(stat -c '%a' "$APP_ENV")" = 600
test -f "$CERT_LINEAGE/fullchain.pem"
test -f "$CERT_LINEAGE/privkey.pem"

if ! ip -4 addr show | grep -Fq "inet $TURN_PUBLIC_IP/"; then
    echo "TURN_PUBLIC_IP must be an IPv4 address assigned to this host" >&2
    exit 1
fi

install -d -o root -g nogroup -m 0750 "$INSTALL_DIR" "$INSTALL_DIR/tls"
install -o root -g root -m 0600 "$SOURCE_DIR/compose.yml" "$INSTALL_DIR/compose.yml"
install -o root -g root -m 0700 "$SOURCE_DIR/verify.sh" "$INSTALL_DIR/verify.sh"
install -o root -g root -m 0755 "$SOURCE_DIR/certbot-renew-hook.sh" \
    /etc/letsencrypt/renewal-hooks/deploy/yv-chat-coturn

secret_file="$INSTALL_DIR/shared-secret"
if ! test -s "$secret_file"; then
    umask 077
    openssl rand -hex 32 >"$secret_file"
fi
chown root:root "$secret_file"
chmod 0600 "$secret_file"
turn_secret=$(sed -n '1p' "$secret_file")

sed \
    -e "s/__TURN_PUBLIC_IP__/$TURN_PUBLIC_IP/g" \
    -e "s/__TURN_SHARED_SECRET__/$turn_secret/g" \
    "$SOURCE_DIR/turnserver.conf.example" >"$INSTALL_DIR/turnserver.conf"
chown root:nogroup "$INSTALL_DIR/turnserver.conf"
chmod 0640 "$INSTALL_DIR/turnserver.conf"

install -o root -g nogroup -m 0640 \
    "$CERT_LINEAGE/fullchain.pem" "$INSTALL_DIR/tls/fullchain.pem"
install -o root -g nogroup -m 0640 \
    "$CERT_LINEAGE/privkey.pem" "$INSTALL_DIR/tls/privkey.pem"

env_owner=$(stat -c '%u' "$APP_ENV")
env_group=$(stat -c '%g' "$APP_ENV")
env_tmp=$(mktemp "${APP_ENV}.coturn.XXXXXX")
cleanup() {
    rm -f -- "$env_tmp"
}
trap cleanup EXIT HUP INT TERM

awk '
    !/^CALLS_ENABLED=/ &&
    !/^CALL_STUN_URLS=/ &&
    !/^CALL_TURN_URLS=/ &&
    !/^CALL_TURN_SHARED_SECRET=/ &&
    !/^CALL_TURN_CREDENTIAL_TTL_SECONDS=/
' "$APP_ENV" >"$env_tmp"
{
    printf '\nCALLS_ENABLED=true\n'
    printf 'CALL_STUN_URLS=["stun:chat.yoowee.ru:3478"]\n'
    printf 'CALL_TURN_URLS=["turn:chat.yoowee.ru:3478?transport=udp","turn:chat.yoowee.ru:3478?transport=tcp","turns:chat.yoowee.ru:5349?transport=tcp"]\n'
    printf 'CALL_TURN_SHARED_SECRET=%s\n' "$turn_secret"
    printf 'CALL_TURN_CREDENTIAL_TTL_SECONDS=3600\n'
} >>"$env_tmp"
chown "$env_owner:$env_group" "$env_tmp"
chmod 0600 "$env_tmp"
mv -f -- "$env_tmp" "$APP_ENV"
trap - EXIT HUP INT TERM

cd "$INSTALL_DIR"
docker compose -p yv-chat-coturn -f compose.yml config --quiet
docker compose -p yv-chat-coturn -f compose.yml up -d --wait --wait-timeout 30
# Bind-mounted config/TLS content does not change the Compose service hash.
docker compose -p yv-chat-coturn -f compose.yml restart coturn
docker compose -p yv-chat-coturn -f compose.yml up -d --wait --wait-timeout 30
TURN_INSTALL_DIR="$INSTALL_DIR" TURN_PUBLIC_IP="$TURN_PUBLIC_IP" "$INSTALL_DIR/verify.sh"
