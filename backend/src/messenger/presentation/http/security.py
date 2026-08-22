"""Browser request security helpers for cookie-authenticated HTTP."""

import secrets
from ipaddress import ip_address, ip_network

from fastapi import HTTPException, status
from starlette.requests import HTTPConnection

from messenger.bootstrap.settings import AppSettings

NATIVE_ORIGIN_HEADER = "X-YV-Native-Origin"


def require_allowed_origin(request: HTTPConnection, settings: AppSettings) -> None:
    """Reject missing and non-exact browser/native origins for state changes."""
    origin = request.headers.get("origin")
    if origin is None:
        origin = request.headers.get(NATIVE_ORIGIN_HEADER)
    if origin is None or origin not in settings.allowed_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="request forbidden")


def require_csrf(request: HTTPConnection, settings: AppSettings) -> None:
    """Require a double-submit CSRF value in addition to exact Origin."""
    require_allowed_origin(request, settings)
    cookie_value = request.cookies.get(settings.csrf_cookie_name)
    header_value = request.headers.get(settings.csrf_header_name)
    if (
        cookie_value is None
        or header_value is None
        or not secrets.compare_digest(cookie_value, header_value)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="request forbidden")


def client_ip(request: HTTPConnection, settings: AppSettings) -> str | None:
    """Resolve peer IP; accept forwarding only from an explicitly trusted chain."""
    if request.client is None:
        return None
    try:
        peer = ip_address(request.client.host)
    except ValueError:
        return None
    trusted_networks = [ip_network(cidr) for cidr in settings.trusted_proxy_cidrs]
    if not any(peer in network for network in trusted_networks):
        return str(peer)

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded is None:
        return str(peer)
    raw_addresses = [part.strip() for part in forwarded.split(",")]
    if not raw_addresses or len(raw_addresses) > 20:
        return str(peer)
    try:
        chain = [ip_address(value) for value in raw_addresses] + [peer]
    except ValueError:
        return str(peer)

    for address in reversed(chain):
        if not any(address in network for network in trusted_networks):
            return str(address)
    return str(chain[0])
