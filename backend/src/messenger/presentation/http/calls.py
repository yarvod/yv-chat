"""Authenticated WebRTC ICE configuration without exposing long-lived TURN secrets."""

import hmac
from base64 import b64encode
from hashlib import sha1
from time import time

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.auth import authenticate_request

router = APIRouter(prefix="/api/v1/calls", tags=["calls"], route_class=DishkaRoute)


class IceServerResponse(BaseModel):
    urls: list[str]
    username: str | None = None
    credential: str | None = None


class CallConfigResponse(BaseModel):
    enabled: bool
    media_encryption: str
    ice_servers: list[IceServerResponse]


@router.get("/config", response_model=CallConfigResponse)
async def get_call_config(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
) -> CallConfigResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    servers: list[IceServerResponse] = []
    if settings.calls_enabled and settings.call_stun_urls:
        servers.append(IceServerResponse(urls=settings.call_stun_urls))
    if settings.calls_enabled and settings.call_turn_urls:
        secret = settings.call_turn_shared_secret
        if secret is None:
            raise RuntimeError("TURN shared secret is unavailable")
        username = f"{int(time()) + settings.call_turn_credential_ttl_seconds}:{principal.user_id}"
        digest = hmac.new(
            secret.get_secret_value().encode("utf-8"),
            username.encode("utf-8"),
            sha1,
        ).digest()
        servers.append(
            IceServerResponse(
                urls=settings.call_turn_urls,
                username=username,
                credential=b64encode(digest).decode("ascii"),
            )
        )
    return CallConfigResponse(
        enabled=settings.calls_enabled,
        media_encryption="DTLS-SRTP",
        ice_servers=servers,
    )
