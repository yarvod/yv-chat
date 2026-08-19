#!/bin/sh
set -eu

EXPECTED_LINEAGE=${TURN_CERT_LINEAGE:-/etc/letsencrypt/live/chat.yoowee.ru}
INSTALL_DIR=${TURN_INSTALL_DIR:-/opt/yv-chat-coturn}

if test "${RENEWED_LINEAGE:-}" != "$EXPECTED_LINEAGE"; then
    exit 0
fi

install -o root -g nogroup -m 0640 \
    "$RENEWED_LINEAGE/fullchain.pem" "$INSTALL_DIR/tls/fullchain.pem"
install -o root -g nogroup -m 0640 \
    "$RENEWED_LINEAGE/privkey.pem" "$INSTALL_DIR/tls/privkey.pem"

docker compose -p yv-chat-coturn -f "$INSTALL_DIR/compose.yml" restart coturn
