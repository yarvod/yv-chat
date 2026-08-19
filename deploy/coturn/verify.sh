#!/bin/sh
set -eu

: "${TURN_PUBLIC_IP:?TURN_PUBLIC_IP is required}"

INSTALL_DIR=${TURN_INSTALL_DIR:-/opt/yv-chat-coturn}
IMAGE='coturn/coturn:4.16.0-r0-alpine@sha256:901954a6b057079e1b12b2e4b4de06e3419e503336ba76c18f62debca3ac4b42'

if test "$(id -u)" -ne 0; then
    echo "coturn verification must run as root" >&2
    exit 1
fi

test -s "$INSTALL_DIR/shared-secret"

acceptance_user="yv-chat-acceptance-$(date +%s)-$$"
output_file=$(mktemp)
cleanup() {
    rm -f -- "$output_file"
}
trap cleanup EXIT HUP INT TERM

if ! docker run --rm \
    --network host \
    --user 0:0 \
    --cap-drop ALL \
    --cap-add NET_BIND_SERVICE \
    --security-opt no-new-privileges:true \
    --read-only \
    --tmpfs /tmp:size=4m,mode=1777 \
    --env TURN_ACCEPTANCE_USER="$acceptance_user" \
    --volume "$INSTALL_DIR/shared-secret:/run/turn-secret:ro" \
    --entrypoint sh \
    "$IMAGE" \
    -c 'turnutils_uclient -u "$TURN_ACCEPTANCE_USER" -W "$(sed -n "1p" /run/turn-secret)" -y -c -n 1 "$1"' \
    sh "$TURN_PUBLIC_IP" >"$output_file" 2>&1; then
    cat "$output_file"
    exit 1
fi

cat "$output_file"
if grep -Eiq 'error|cannot|fail' "$output_file"; then
    exit 1
fi
grep -Eq 'tot_send_msgs=2, tot_recv_msgs=2' "$output_file"
grep -Eq 'Total lost packets 0 ' "$output_file"
