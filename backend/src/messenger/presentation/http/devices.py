"""User-scoped active device, session and security-event transport."""

from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.errors import (
    CurrentDeviceRevocationError,
    OwnedDeviceNotFoundError,
    SessionNotAuthenticatedError,
)
from messenger.application.use_cases.authenticate_session import AuthenticateSession
from messenger.application.use_cases.list_my_sessions import ListMySessions, ListMySessionsQuery
from messenger.application.use_cases.list_security_events import (
    ListSecurityEvents,
    ListSecurityEventsQuery,
)
from messenger.application.use_cases.rename_my_device import RenameMyDevice, RenameMyDeviceCommand
from messenger.application.use_cases.revoke_my_device import RevokeMyDevice, RevokeMyDeviceCommand
from messenger.application.use_cases.revoke_other_sessions import (
    RevokeOtherSessions,
    RevokeOtherSessionsCommand,
)
from messenger.bootstrap.settings import AppSettings
from messenger.domain.entities import SecurityEventType
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(prefix="/api/v1", tags=["devices"], route_class=DishkaRoute)


class DeviceSessionResponse(BaseModel):
    session_id: UUID
    device_id: UUID
    device_name: str
    is_current: bool
    created_at: datetime
    last_seen_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    login_ip: str | None
    last_ip: str | None


class RenameDeviceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RenameDeviceResponse(BaseModel):
    device_id: UUID
    name: str


class RevokeOthersResponse(BaseModel):
    revoked_count: int


class SecurityEventResponse(BaseModel):
    id: UUID
    event_type: SecurityEventType
    created_at: datetime
    actor_session_id: UUID | None
    target_device_id: UUID | None


@router.get("/devices", response_model=list[DeviceSessionResponse])
async def list_devices(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListMySessions],
) -> list[DeviceSessionResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    items = await use_case.execute(
        ListMySessionsQuery(
            user_id=principal.user_id,
            current_session_id=principal.session_id,
        )
    )
    return [DeviceSessionResponse.model_validate(item, from_attributes=True) for item in items]


@router.patch("/devices/{device_id}", response_model=RenameDeviceResponse)
async def rename_device(
    device_id: UUID,
    payload: RenameDeviceRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[RenameMyDevice],
) -> RenameDeviceResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            RenameMyDeviceCommand(
                user_id=principal.user_id,
                current_session_id=principal.session_id,
                device_id=device_id,
                name=payload.name,
            )
        )
    except OwnedDeviceNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="device not found",
        ) from error
    except DomainValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid device name",
        ) from error
    return RenameDeviceResponse(device_id=result.device_id, name=result.name)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_device(
    device_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[RevokeMyDevice],
) -> None:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        await use_case.execute(
            RevokeMyDeviceCommand(
                user_id=principal.user_id,
                current_session_id=principal.session_id,
                device_id=device_id,
            )
        )
    except OwnedDeviceNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="device not found",
        ) from error
    except CurrentDeviceRevocationError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="use logout for the current device",
        ) from error


@router.post("/sessions/revoke-others", response_model=RevokeOthersResponse)
async def revoke_other_sessions(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[RevokeOtherSessions],
) -> RevokeOthersResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            RevokeOtherSessionsCommand(
                user_id=principal.user_id,
                current_session_id=principal.session_id,
            )
        )
    except SessionNotAuthenticatedError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unauthorized",
        ) from error
    return RevokeOthersResponse(revoked_count=result.revoked_count)


@router.get("/security-events", response_model=list[SecurityEventResponse])
async def list_security_events(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListSecurityEvents],
    limit: int = Query(default=50, ge=1, le=100),
) -> list[SecurityEventResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    items = await use_case.execute(ListSecurityEventsQuery(user_id=principal.user_id, limit=limit))
    return [SecurityEventResponse.model_validate(item, from_attributes=True) for item in items]
