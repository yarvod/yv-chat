"""Current-device Web Push transport."""

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.errors import PushSubscriptionConflictError
from messenger.application.push.manage_subscription import (
    CurrentPushSubscriptionQuery,
    GetCurrentPushSubscription,
    RegisterPushSubscription,
    RegisterPushSubscriptionCommand,
    RemovePushSubscription,
    RemovePushSubscriptionCommand,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(prefix="/api/v1/push", tags=["push"], route_class=DishkaRoute)


class PushConfigResponse(BaseModel):
    enabled: bool
    application_server_key: str | None


class PushSubscriptionStatusResponse(BaseModel):
    registered: bool


class PushSubscriptionKeysRequest(BaseModel):
    p256dh: str = Field(min_length=1, max_length=256)
    auth: str = Field(min_length=1, max_length=128)


class RegisterPushSubscriptionRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: PushSubscriptionKeysRequest


@router.get("/config", response_model=PushConfigResponse)
async def get_push_config(settings: FromDishka[AppSettings]) -> PushConfigResponse:
    return PushConfigResponse(
        enabled=settings.push_enabled,
        application_server_key=settings.vapid_public_key,
    )


@router.get("/subscription", response_model=PushSubscriptionStatusResponse)
async def get_push_subscription(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[GetCurrentPushSubscription],
) -> PushSubscriptionStatusResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    result = await use_case.execute(
        CurrentPushSubscriptionQuery(
            user_id=principal.user_id,
            device_id=principal.device_id,
        )
    )
    return PushSubscriptionStatusResponse(registered=result.registered)


@router.put("/subscription", status_code=status.HTTP_204_NO_CONTENT)
async def register_push_subscription(
    payload: RegisterPushSubscriptionRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[RegisterPushSubscription],
) -> None:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    if not settings.push_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="push disabled")
    try:
        await use_case.execute(
            RegisterPushSubscriptionCommand(
                user_id=principal.user_id,
                device_id=principal.device_id,
                endpoint=payload.endpoint,
                p256dh=payload.keys.p256dh,
                auth=payload.keys.auth,
            )
        )
    except DomainValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid push subscription",
        ) from error
    except PushSubscriptionConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="push subscription conflict",
        ) from error


@router.delete("/subscription", status_code=status.HTTP_204_NO_CONTENT)
async def remove_push_subscription(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[RemovePushSubscription],
) -> None:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    await use_case.execute(
        RemovePushSubscriptionCommand(
            user_id=principal.user_id,
            device_id=principal.device_id,
        )
    )
