"""Authenticated current-account HTTP transport."""

from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.accounts.change_password import (
    ChangeCurrentPassword,
    ChangeCurrentPasswordCommand,
)
from messenger.application.accounts.get_current import (
    GetCurrentAccount,
    GetCurrentAccountQuery,
)
from messenger.application.accounts.security_reset import SecurityReset, SecurityResetCommand
from messenger.application.accounts.update_profile import (
    UpdateCurrentProfile,
    UpdateCurrentProfileCommand,
)
from messenger.application.errors import (
    InvalidStepUpCredentialsError,
    SessionNotAuthenticatedError,
    WeakPasswordError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request, delete_auth_cookies
from messenger.presentation.http.security import require_csrf

router = APIRouter(prefix="/api/v1/me", tags=["current-account"], route_class=DishkaRoute)


class CurrentAccountResponse(BaseModel):
    user_id: UUID
    username: str
    display_name: str
    is_admin: bool
    created_at: datetime
    updated_at: datetime


class UpdateCurrentProfileRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)


class ChangeCurrentPasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class ChangeCurrentPasswordResponse(BaseModel):
    revoked_sessions: int


class SecurityResetRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)


def invalid_step_up(error: InvalidStepUpCredentialsError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="current password is invalid",
    )


def unauthorized(error: SessionNotAuthenticatedError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


@router.get("", response_model=CurrentAccountResponse)
async def get_current_account(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[GetCurrentAccount],
) -> CurrentAccountResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(GetCurrentAccountQuery(user_id=principal.user_id))
    except SessionNotAuthenticatedError as error:
        raise unauthorized(error) from error
    return CurrentAccountResponse.model_validate(result, from_attributes=True)


@router.patch("", response_model=CurrentAccountResponse)
async def update_current_profile(
    payload: UpdateCurrentProfileRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[UpdateCurrentProfile],
) -> CurrentAccountResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            UpdateCurrentProfileCommand(
                user_id=principal.user_id,
                display_name=payload.display_name,
            )
        )
    except SessionNotAuthenticatedError as error:
        raise unauthorized(error) from error
    except DomainValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid profile data",
        ) from error
    return CurrentAccountResponse(
        user_id=result.id,
        username=result.username,
        display_name=result.display_name,
        is_admin=result.is_admin,
        created_at=result.created_at,
        updated_at=result.updated_at,
    )


@router.patch("/password", response_model=ChangeCurrentPasswordResponse)
async def change_current_password(
    payload: ChangeCurrentPasswordRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ChangeCurrentPassword],
) -> ChangeCurrentPasswordResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            ChangeCurrentPasswordCommand(
                user_id=principal.user_id,
                current_session_id=principal.session_id,
                current_password=payload.current_password,
                new_password=payload.new_password,
            )
        )
    except InvalidStepUpCredentialsError as error:
        raise invalid_step_up(error) from error
    except SessionNotAuthenticatedError as error:
        raise unauthorized(error) from error
    except WeakPasswordError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="password does not meet policy",
        ) from error
    return ChangeCurrentPasswordResponse.model_validate(result, from_attributes=True)


@router.post("/security-reset", status_code=status.HTTP_204_NO_CONTENT)
async def security_reset(
    payload: SecurityResetRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[SecurityReset],
) -> None:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        await use_case.execute(
            SecurityResetCommand(
                user_id=principal.user_id,
                current_session_id=principal.session_id,
                current_password=payload.current_password,
            )
        )
    except InvalidStepUpCredentialsError as error:
        raise invalid_step_up(error) from error
    except SessionNotAuthenticatedError as error:
        raise unauthorized(error) from error
    delete_auth_cookies(response, settings)
