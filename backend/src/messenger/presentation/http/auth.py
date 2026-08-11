"""Versioned browser authentication HTTP transport."""

import secrets
from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.accounts.activate import ActivateAccount, ActivateAccountCommand
from messenger.application.errors import (
    AccountAlreadyActiveError,
    ActivationAlreadyUsedError,
    ActivationExpiredError,
    InvalidActivationSecretError,
    InvalidCredentialsError,
    SessionNotAuthenticatedError,
    WeakPasswordError,
)
from messenger.application.sessions.authenticate import (
    AuthenticateSession,
    AuthenticateSessionCommand,
    AuthenticateSessionResult,
)
from messenger.application.sessions.login import Login, LoginCommand
from messenger.application.sessions.logout import Logout, LogoutCommand
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.security import client_ip, require_allowed_origin, require_csrf

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["authentication"],
    route_class=DishkaRoute,
)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    device_name: str = Field(min_length=1, max_length=80)


class ActivateAccountRequest(BaseModel):
    activation_secret: str = Field(min_length=32, max_length=512)
    password: str = Field(min_length=12, max_length=128)


class ActivateAccountResponse(BaseModel):
    user_id: UUID
    activated_at: datetime


class SessionResponse(BaseModel):
    user_id: UUID
    session_id: UUID
    device_id: UUID
    absolute_expires_at: datetime


def set_session_cookie(
    response: Response,
    settings: AppSettings,
    credential: str,
    expires_at: datetime,
) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=credential,
        expires=expires_at,
        secure=True,
        httponly=True,
        samesite="strict",
        path="/",
    )


@router.post("/activate", response_model=ActivateAccountResponse)
async def activate_account(
    request: Request,
    payload: ActivateAccountRequest,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[ActivateAccount],
) -> ActivateAccountResponse:
    require_allowed_origin(request, settings)
    try:
        result = await use_case.execute(
            ActivateAccountCommand(
                activation_secret=payload.activation_secret,
                password=payload.password,
            )
        )
    except WeakPasswordError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="password does not meet policy",
        ) from error
    except (
        InvalidActivationSecretError,
        ActivationExpiredError,
        ActivationAlreadyUsedError,
        AccountAlreadyActiveError,
    ) as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="activation failed",
        ) from error
    return ActivateAccountResponse.model_validate(result, from_attributes=True)


async def authenticate_request(
    request: Request,
    response: Response,
    settings: AppSettings,
    authenticate_session: AuthenticateSession,
) -> AuthenticateSessionResult:
    """Authenticate the cookie and transparently apply credential rotation."""
    credential = request.cookies.get(settings.session_cookie_name)
    if credential is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    try:
        result = await authenticate_session.execute(
            AuthenticateSessionCommand(
                session_credential=credential,
                client_ip=client_ip(request, settings),
            )
        )
    except SessionNotAuthenticatedError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unauthorized",
        ) from error
    if result.rotated_session_credential is not None:
        set_session_cookie(
            response,
            settings,
            result.rotated_session_credential,
            result.absolute_expires_at,
        )
    return result


@router.post("/login", response_model=SessionResponse)
async def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[Login],
) -> SessionResponse:
    require_allowed_origin(request, settings)
    try:
        result = await use_case.execute(
            LoginCommand(
                username=payload.username,
                password=payload.password,
                device_name=payload.device_name,
                client_ip=client_ip(request, settings),
            )
        )
    except InvalidCredentialsError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid username or password",
        ) from error
    except DomainValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid login data",
        ) from error

    set_session_cookie(
        response,
        settings,
        result.session_credential,
        result.absolute_expires_at,
    )
    csrf_value = secrets.token_urlsafe(32)
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=csrf_value,
        expires=result.absolute_expires_at,
        secure=True,
        httponly=False,
        samesite="strict",
        path="/",
    )
    return SessionResponse(
        user_id=result.user_id,
        session_id=result.session_id,
        device_id=result.device_id,
        absolute_expires_at=result.absolute_expires_at,
    )


@router.get("/session", response_model=SessionResponse)
async def current_session(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[AuthenticateSession],
) -> SessionResponse:
    result = await authenticate_request(request, response, settings, use_case)
    return SessionResponse(
        user_id=result.user_id,
        session_id=result.session_id,
        device_id=result.device_id,
        absolute_expires_at=result.absolute_expires_at,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[Logout],
) -> None:
    require_csrf(request, settings)
    credential = request.cookies.get(settings.session_cookie_name)
    if credential is not None:
        await use_case.execute(LogoutCommand(session_credential=credential))
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    response.delete_cookie(
        settings.csrf_cookie_name,
        path="/",
        secure=True,
        httponly=False,
        samesite="strict",
    )
