"""Versioned browser authentication HTTP transport."""

import secrets
from datetime import datetime
from typing import cast
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.errors import InvalidCredentialsError, SessionNotAuthenticatedError
from messenger.application.use_cases.authenticate_session import AuthenticateSessionCommand
from messenger.application.use_cases.login import LoginCommand
from messenger.application.use_cases.logout import LogoutCommand
from messenger.bootstrap.container import AuthServices
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.security import client_ip, require_allowed_origin, require_csrf

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    device_name: str = Field(min_length=1, max_length=80)


class SessionResponse(BaseModel):
    user_id: UUID
    session_id: UUID
    device_id: UUID
    absolute_expires_at: datetime


def settings_from(request: Request) -> AppSettings:
    return cast(AppSettings, request.app.state.settings)


def services_from(request: Request) -> AuthServices:
    return cast(AuthServices, request.app.state.auth_services)


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


@router.post("/login", response_model=SessionResponse)
async def login(request: Request, response: Response, payload: LoginRequest) -> SessionResponse:
    settings = settings_from(request)
    require_allowed_origin(request, settings)
    try:
        result = await services_from(request).login.execute(
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
) -> SessionResponse:
    settings = settings_from(request)
    credential = request.cookies.get(settings.session_cookie_name)
    if credential is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    try:
        result = await services_from(request).authenticate_session.execute(
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
    return SessionResponse(
        user_id=result.user_id,
        session_id=result.session_id,
        device_id=result.device_id,
        absolute_expires_at=result.absolute_expires_at,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response) -> None:
    settings = settings_from(request)
    require_csrf(request, settings)
    credential = request.cookies.get(settings.session_cookie_name)
    if credential is not None:
        await services_from(request).logout.execute(LogoutCommand(session_credential=credential))
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
