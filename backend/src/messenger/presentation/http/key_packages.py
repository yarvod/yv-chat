"""Authenticated transport for one-time MLS KeyPackage delivery."""

import base64
from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.device_crypto.claim_key_package import (
    ClaimDeviceKeyPackage,
    ClaimDeviceKeyPackageCommand,
)
from messenger.application.device_crypto.dto import (
    ClaimedDeviceKeyPackageResult,
    DeviceKeyPackageInventoryResult,
    ReplenishDeviceKeyPackagesResult,
)
from messenger.application.device_crypto.list_key_packages import (
    ListDeviceKeyPackageInventory,
    ListDeviceKeyPackageInventoryQuery,
)
from messenger.application.device_crypto.replenish_key_packages import (
    ReplenishDeviceKeyPackages,
    ReplenishDeviceKeyPackagesCommand,
)
from messenger.application.errors import (
    ConversationNotFoundError,
    DeviceCryptoIdentityNotFoundError,
    DeviceKeyPackageConflictError,
    DeviceKeyPackageUnavailableError,
    OwnedDeviceNotFoundError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.crypto_encoding import decode_canonical_base64
from messenger.presentation.http.security import require_csrf

device_router = APIRouter(
    prefix="/api/v1/devices/current/key-packages",
    tags=["device-key-packages"],
    route_class=DishkaRoute,
)
conversation_router = APIRouter(
    prefix="/api/v1/conversations",
    tags=["device-key-packages"],
    route_class=DishkaRoute,
)


class ReplenishDeviceKeyPackagesRequest(BaseModel):
    key_packages_base64: list[str] = Field(min_length=1, max_length=16)


class DeviceKeyPackageInventoryResponse(BaseModel):
    device_id: UUID
    available_count: int


class ReplenishDeviceKeyPackagesResponse(DeviceKeyPackageInventoryResponse):
    added_count: int


class ClaimDeviceKeyPackageRequest(BaseModel):
    target_device_id: UUID
    claim_request_id: UUID


class ClaimedDeviceKeyPackageResponse(BaseModel):
    conversation_id: UUID
    claim_request_id: UUID
    target_device_id: UUID
    target_user_id: UUID
    protocol_version: int
    credential_identity_base64: str
    signature_public_key_base64: str
    fingerprint: str
    package_ref: str
    key_package_base64: str
    claimed_at: datetime


def claim_response(result: ClaimedDeviceKeyPackageResult) -> ClaimedDeviceKeyPackageResponse:
    return ClaimedDeviceKeyPackageResponse(
        conversation_id=result.conversation_id,
        claim_request_id=result.claim_request_id,
        target_device_id=result.target_device_id,
        target_user_id=result.target_user_id,
        protocol_version=result.protocol_version,
        credential_identity_base64=base64.b64encode(result.credential_identity).decode("ascii"),
        signature_public_key_base64=base64.b64encode(result.signature_public_key).decode("ascii"),
        fingerprint=result.fingerprint,
        package_ref=result.package_ref,
        key_package_base64=base64.b64encode(result.key_package).decode("ascii"),
        claimed_at=result.claimed_at,
    )


def translate_key_package_error(error: Exception) -> HTTPException:
    if isinstance(error, (DeviceKeyPackageConflictError, DeviceKeyPackageUnavailableError)):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="KeyPackage unavailable")
    if isinstance(
        error,
        (
            ConversationNotFoundError,
            DeviceCryptoIdentityNotFoundError,
            OwnedDeviceNotFoundError,
        ),
    ):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="resource not found")
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="invalid KeyPackage request",
    )


@device_router.get("", response_model=DeviceKeyPackageInventoryResponse)
async def list_current_device_key_packages(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListDeviceKeyPackageInventory],
) -> DeviceKeyPackageInventoryResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result: DeviceKeyPackageInventoryResult = await use_case.execute(
            ListDeviceKeyPackageInventoryQuery(principal.user_id, principal.device_id)
        )
    except (DeviceCryptoIdentityNotFoundError, OwnedDeviceNotFoundError) as error:
        raise translate_key_package_error(error) from error
    return DeviceKeyPackageInventoryResponse(
        device_id=result.device_id,
        available_count=result.available_count,
    )


@device_router.post("", response_model=ReplenishDeviceKeyPackagesResponse)
async def replenish_current_device_key_packages(
    payload: ReplenishDeviceKeyPackagesRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ReplenishDeviceKeyPackages],
) -> ReplenishDeviceKeyPackagesResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result: ReplenishDeviceKeyPackagesResult = await use_case.execute(
            ReplenishDeviceKeyPackagesCommand(
                user_id=principal.user_id,
                device_id=principal.device_id,
                key_packages=tuple(
                    decode_canonical_base64(encoded, detail="invalid KeyPackage request")
                    for encoded in payload.key_packages_base64
                ),
            )
        )
    except (
        DeviceCryptoIdentityNotFoundError,
        DeviceKeyPackageConflictError,
        OwnedDeviceNotFoundError,
        DomainValidationError,
    ) as error:
        raise translate_key_package_error(error) from error
    return ReplenishDeviceKeyPackagesResponse(
        device_id=result.device_id,
        added_count=result.added_count,
        available_count=result.available_count,
    )


@conversation_router.post(
    "/{conversation_id}/key-package-claims",
    response_model=ClaimedDeviceKeyPackageResponse,
)
async def claim_conversation_device_key_package(
    conversation_id: UUID,
    payload: ClaimDeviceKeyPackageRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ClaimDeviceKeyPackage],
) -> ClaimedDeviceKeyPackageResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            ClaimDeviceKeyPackageCommand(
                user_id=principal.user_id,
                device_id=principal.device_id,
                conversation_id=conversation_id,
                target_device_id=payload.target_device_id,
                claim_request_id=payload.claim_request_id,
            )
        )
    except (
        ConversationNotFoundError,
        DeviceCryptoIdentityNotFoundError,
        DeviceKeyPackageConflictError,
        DeviceKeyPackageUnavailableError,
        OwnedDeviceNotFoundError,
        DomainValidationError,
    ) as error:
        raise translate_key_package_error(error) from error
    return claim_response(result)
