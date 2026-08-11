"""Authenticated HTTP transport for opaque MLS conversation coordination."""

import base64
from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.conversation_crypto.acknowledge_welcome import (
    AcknowledgeConversationCryptoWelcome,
    AcknowledgeConversationCryptoWelcomeCommand,
)
from messenger.application.conversation_crypto.begin import (
    BeginConversationCrypto,
    BeginConversationCryptoCommand,
)
from messenger.application.conversation_crypto.dto import ConversationCryptoResult
from messenger.application.conversation_crypto.finalize import (
    DeviceWelcomeInput,
    FinalizeConversationCrypto,
    FinalizeConversationCryptoCommand,
)
from messenger.application.conversation_crypto.get_current import (
    GetCurrentConversationCrypto,
    GetCurrentConversationCryptoQuery,
)
from messenger.application.conversation_crypto.list_updates import (
    ListConversationCryptoUpdates,
    ListConversationCryptoUpdatesQuery,
)
from messenger.application.errors import (
    ConversationCryptoConflictError,
    ConversationCryptoNotFoundError,
    ConversationCryptoNotReadyError,
    ConversationNotFoundError,
    InvalidConversationCryptoUpdateBoundsError,
    OwnedDeviceNotFoundError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.crypto_encoding import decode_canonical_base64
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/conversations/{conversation_id}/crypto",
    tags=["conversation-crypto"],
    route_class=DishkaRoute,
)


class BeginConversationCryptoRequest(BaseModel):
    bootstrap_request_id: UUID


class DeviceWelcomeRequest(BaseModel):
    target_device_id: UUID
    welcome_base64: str = Field(min_length=4, max_length=1_398_104)


class FinalizeConversationCryptoRequest(BaseModel):
    epoch: int = Field(gt=0)
    commit_base64: str = Field(min_length=4, max_length=1_398_104)
    ratchet_tree_base64: str = Field(min_length=4, max_length=1_398_104)
    welcomes: list[DeviceWelcomeRequest] = Field(max_length=200)


class RequiredDeviceCryptoResponse(BaseModel):
    user_id: UUID
    device_id: UUID
    is_coordinator: bool
    fingerprint: str | None
    credential_identity_base64: str | None
    signature_public_key_base64: str | None
    key_package_ref: str | None
    key_package_base64: str | None


class DeviceWelcomeResponse(BaseModel):
    target_device_id: UUID
    welcome_base64: str
    created_at: datetime
    expires_at: datetime
    acknowledged_at: datetime | None


class ConversationCryptoResponse(BaseModel):
    generation_id: UUID
    conversation_id: UUID
    generation_number: int
    protocol_version: int
    status: str
    block_reason: str | None
    coordinator_device_id: UUID
    epoch: int | None
    commit_base64: str | None
    ratchet_tree_base64: str | None
    created_at: datetime
    updated_at: datetime
    ready_at: datetime | None
    required_devices: list[RequiredDeviceCryptoResponse]
    welcome: DeviceWelcomeResponse | None


class ConversationCryptoUpdatesResponse(BaseModel):
    generations: list[ConversationCryptoResponse]


def _encode_optional(value: bytes | None) -> str | None:
    return base64.b64encode(value).decode("ascii") if value is not None else None


def crypto_response(result: ConversationCryptoResult) -> ConversationCryptoResponse:
    generation = result.generation
    welcome = result.welcome
    return ConversationCryptoResponse(
        generation_id=generation.id,
        conversation_id=generation.conversation_id,
        generation_number=generation.generation_number,
        protocol_version=generation.protocol_version,
        status=generation.status.value,
        block_reason=generation.block_reason.value if generation.block_reason else None,
        coordinator_device_id=generation.coordinator_device_id,
        epoch=generation.epoch,
        commit_base64=_encode_optional(generation.commit_message),
        ratchet_tree_base64=_encode_optional(generation.ratchet_tree),
        created_at=generation.created_at,
        updated_at=generation.updated_at,
        ready_at=generation.ready_at,
        required_devices=[
            RequiredDeviceCryptoResponse(
                user_id=item.user_id,
                device_id=item.device_id,
                is_coordinator=item.is_coordinator,
                fingerprint=item.fingerprint,
                credential_identity_base64=_encode_optional(item.credential_identity),
                signature_public_key_base64=_encode_optional(item.signature_public_key),
                key_package_ref=item.key_package_ref,
                key_package_base64=_encode_optional(item.key_package),
            )
            for item in result.required_devices
        ],
        welcome=(
            DeviceWelcomeResponse(
                target_device_id=welcome.target_device_id,
                welcome_base64=base64.b64encode(welcome.welcome_message).decode("ascii"),
                created_at=welcome.created_at,
                expires_at=welcome.expires_at,
                acknowledged_at=welcome.acknowledged_at,
            )
            if welcome is not None
            else None
        ),
    )


def translate_crypto_error(error: Exception) -> HTTPException:
    if isinstance(
        error,
        (ConversationCryptoConflictError, ConversationCryptoNotReadyError),
    ):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="crypto state conflict")
    if isinstance(
        error,
        (
            ConversationCryptoNotFoundError,
            ConversationNotFoundError,
            OwnedDeviceNotFoundError,
        ),
    ):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="resource not found")
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="invalid crypto lifecycle payload",
    )


@router.post("/bootstrap", response_model=ConversationCryptoResponse)
async def begin_conversation_crypto(
    conversation_id: UUID,
    payload: BeginConversationCryptoRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[BeginConversationCrypto],
) -> ConversationCryptoResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            BeginConversationCryptoCommand(
                principal.user_id,
                principal.device_id,
                conversation_id,
                payload.bootstrap_request_id,
            )
        )
    except (
        ConversationCryptoConflictError,
        ConversationNotFoundError,
        OwnedDeviceNotFoundError,
        DomainValidationError,
    ) as error:
        raise translate_crypto_error(error) from error
    return crypto_response(result)


@router.get("", response_model=ConversationCryptoResponse)
async def get_current_conversation_crypto(
    conversation_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[GetCurrentConversationCrypto],
) -> ConversationCryptoResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            GetCurrentConversationCryptoQuery(
                principal.user_id,
                principal.device_id,
                conversation_id,
            )
        )
    except (
        ConversationCryptoNotFoundError,
        ConversationNotFoundError,
        OwnedDeviceNotFoundError,
    ) as error:
        raise translate_crypto_error(error) from error
    return crypto_response(result)


@router.get("/updates", response_model=ConversationCryptoUpdatesResponse)
async def list_conversation_crypto_updates(
    conversation_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListConversationCryptoUpdates],
    after_generation_number: int = Query(ge=0),
    limit: int = Query(default=100, ge=1, le=100),
) -> ConversationCryptoUpdatesResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        results = await use_case.execute(
            ListConversationCryptoUpdatesQuery(
                principal.user_id,
                principal.device_id,
                conversation_id,
                after_generation_number,
                limit,
            )
        )
    except (
        ConversationNotFoundError,
        OwnedDeviceNotFoundError,
        InvalidConversationCryptoUpdateBoundsError,
    ) as error:
        raise translate_crypto_error(error) from error
    return ConversationCryptoUpdatesResponse(
        generations=[crypto_response(result) for result in results]
    )


@router.put("/generations/{generation_id}", response_model=ConversationCryptoResponse)
async def finalize_conversation_crypto(
    conversation_id: UUID,
    generation_id: UUID,
    payload: FinalizeConversationCryptoRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[FinalizeConversationCrypto],
) -> ConversationCryptoResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            FinalizeConversationCryptoCommand(
                user_id=principal.user_id,
                device_id=principal.device_id,
                conversation_id=conversation_id,
                generation_id=generation_id,
                epoch=payload.epoch,
                commit_message=decode_canonical_base64(
                    payload.commit_base64,
                    detail="invalid crypto lifecycle payload",
                ),
                ratchet_tree=decode_canonical_base64(
                    payload.ratchet_tree_base64,
                    detail="invalid crypto lifecycle payload",
                ),
                welcomes=tuple(
                    DeviceWelcomeInput(
                        item.target_device_id,
                        decode_canonical_base64(
                            item.welcome_base64,
                            detail="invalid crypto lifecycle payload",
                        ),
                    )
                    for item in payload.welcomes
                ),
            )
        )
    except (
        ConversationCryptoConflictError,
        ConversationCryptoNotFoundError,
        ConversationCryptoNotReadyError,
        ConversationNotFoundError,
        OwnedDeviceNotFoundError,
        DomainValidationError,
    ) as error:
        raise translate_crypto_error(error) from error
    return crypto_response(result)


@router.post("/generations/{generation_id}/welcome-ack", status_code=status.HTTP_204_NO_CONTENT)
async def acknowledge_conversation_crypto_welcome(
    conversation_id: UUID,
    generation_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[AcknowledgeConversationCryptoWelcome],
) -> Response:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        await use_case.execute(
            AcknowledgeConversationCryptoWelcomeCommand(
                principal.user_id,
                principal.device_id,
                conversation_id,
                generation_id,
            )
        )
    except (
        ConversationCryptoNotFoundError,
        ConversationNotFoundError,
        OwnedDeviceNotFoundError,
        DomainValidationError,
    ) as error:
        raise translate_crypto_error(error) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)
