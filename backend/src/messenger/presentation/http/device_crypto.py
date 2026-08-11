"""Authenticated transport for the current device public crypto anchor."""

import base64
import binascii
from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.device_crypto.dto import DeviceCryptoIdentityResult
from messenger.application.device_crypto.get_current import (
    GetCurrentDeviceCryptoIdentity,
    GetCurrentDeviceCryptoIdentityQuery,
)
from messenger.application.device_crypto.register import (
    RegisterDeviceCryptoIdentity,
    RegisterDeviceCryptoIdentityCommand,
)
from messenger.application.errors import (
    DeviceCryptoIdentityConflictError,
    DeviceCryptoIdentityNotFoundError,
    OwnedDeviceNotFoundError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/devices/current",
    tags=["device-crypto"],
    route_class=DishkaRoute,
)


class RegisterDeviceCryptoIdentityRequest(BaseModel):
    credential_identity_base64: str = Field(min_length=44, max_length=44)
    signature_public_key_base64: str = Field(min_length=44, max_length=44)
    key_package_base64: str = Field(min_length=4, max_length=1_398_104)


class DeviceCryptoIdentityResponse(BaseModel):
    device_id: UUID
    user_id: UUID
    protocol_version: int
    credential_identity_base64: str
    signature_public_key_base64: str
    fingerprint: str
    initial_key_package_ref: str
    created_at: datetime


def decode_canonical_base64(encoded: str) -> bytes:
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid device crypto identity",
        ) from error
    if base64.b64encode(decoded).decode("ascii") != encoded:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid device crypto identity",
        )
    return decoded


def identity_response(result: DeviceCryptoIdentityResult) -> DeviceCryptoIdentityResponse:
    return DeviceCryptoIdentityResponse(
        device_id=result.device_id,
        user_id=result.user_id,
        protocol_version=result.protocol_version,
        credential_identity_base64=base64.b64encode(result.credential_identity).decode("ascii"),
        signature_public_key_base64=base64.b64encode(result.signature_public_key).decode("ascii"),
        fingerprint=result.fingerprint,
        initial_key_package_ref=result.initial_key_package_ref,
        created_at=result.created_at,
    )


def translate_identity_error(error: Exception) -> HTTPException:
    if isinstance(error, DeviceCryptoIdentityConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="device crypto identity conflicts with the registered identity",
        )
    if isinstance(error, (DeviceCryptoIdentityNotFoundError, OwnedDeviceNotFoundError)):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="device crypto identity not found",
        )
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="invalid device crypto identity",
    )


@router.get("/crypto-identity", response_model=DeviceCryptoIdentityResponse)
async def get_current_device_crypto_identity(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[GetCurrentDeviceCryptoIdentity],
) -> DeviceCryptoIdentityResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            GetCurrentDeviceCryptoIdentityQuery(
                user_id=principal.user_id,
                device_id=principal.device_id,
            )
        )
    except (
        DeviceCryptoIdentityConflictError,
        DeviceCryptoIdentityNotFoundError,
        OwnedDeviceNotFoundError,
    ) as error:
        raise translate_identity_error(error) from error
    return identity_response(result)


@router.put("/crypto-identity", response_model=DeviceCryptoIdentityResponse)
async def register_current_device_crypto_identity(
    payload: RegisterDeviceCryptoIdentityRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[RegisterDeviceCryptoIdentity],
) -> DeviceCryptoIdentityResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            RegisterDeviceCryptoIdentityCommand(
                user_id=principal.user_id,
                device_id=principal.device_id,
                credential_identity=decode_canonical_base64(payload.credential_identity_base64),
                signature_public_key=decode_canonical_base64(payload.signature_public_key_base64),
                key_package=decode_canonical_base64(payload.key_package_base64),
            )
        )
    except (
        DeviceCryptoIdentityConflictError,
        OwnedDeviceNotFoundError,
        DomainValidationError,
    ) as error:
        raise translate_identity_error(error) from error
    return identity_response(result)
