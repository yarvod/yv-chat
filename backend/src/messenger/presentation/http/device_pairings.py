"""Versioned durable QR device-pairing transport."""

from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.device_pairings.approve import (
    ApproveDevicePairing,
    ApproveDevicePairingCommand,
)
from messenger.application.device_pairings.authorize import (
    AuthorizeDevicePairing,
    AuthorizeDevicePairingCommand,
)
from messenger.application.device_pairings.cancel import (
    CancelCandidatePairing,
    CancelCandidatePairingCommand,
    CancelTrustedPairing,
    CancelTrustedPairingCommand,
)
from messenger.application.device_pairings.common import DevicePairingView
from messenger.application.device_pairings.create_offer import (
    CreatePairingOffer,
    CreatePairingOfferCommand,
)
from messenger.application.device_pairings.create_request import (
    CreatePairingRequest,
    CreatePairingRequestCommand,
)
from messenger.application.device_pairings.history import (
    AcknowledgeHistoryChunk,
    AcknowledgeHistoryChunkCommand,
    ListHistoryChunks,
    ListHistoryChunksQuery,
    ListOutboundHistoryChunks,
    UploadHistoryChunk,
    UploadHistoryChunkCommand,
)
from messenger.application.device_pairings.scan import (
    ScanPairingOffer,
    ScanPairingOfferCommand,
    ScanPairingRequest,
    ScanPairingRequestCommand,
)
from messenger.application.device_pairings.status import (
    GetCandidatePairingStatus,
    GetCandidatePairingStatusQuery,
    GetTrustedPairingStatus,
    GetTrustedPairingStatusQuery,
)
from messenger.application.errors import (
    DevicePairingNotFoundError,
    DevicePairingProofError,
    DevicePairingStateError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.entities import DeviceHistoryChunk
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import (
    SessionResponse,
    authenticate_request,
    set_new_session_cookies,
)
from messenger.presentation.http.security import client_ip, require_allowed_origin, require_csrf

router = APIRouter(
    prefix="/api/v1/device-pairings",
    tags=["device-pairings"],
    route_class=DishkaRoute,
)


class CreatePairingRequestBody(BaseModel):
    candidate_proof_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    candidate_device_name: str = Field(min_length=1, max_length=80)


class ScanPairingBody(BaseModel):
    scan_token: str = Field(min_length=32, max_length=128)


class ScanOfferBody(ScanPairingBody):
    candidate_proof_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    candidate_device_name: str = Field(min_length=1, max_length=80)


class CandidateProofBody(BaseModel):
    candidate_proof: str = Field(min_length=32, max_length=128)


class CreatePairingResponse(BaseModel):
    pairing_id: UUID
    protocol_version: int
    purpose: str
    scan_token: str
    expires_at: datetime


class PairingStatusResponse(BaseModel):
    pairing_id: UUID
    protocol_version: int
    purpose: str
    status: str
    candidate_device_name: str | None
    trusted_device_name: str | None
    account_display_name: str | None
    authentication_code: str | None
    expires_at: datetime
    authorized_device_id: UUID | None
    trusted_device_id: UUID | None


class UploadHistoryChunkBody(BaseModel):
    target_device_id: UUID
    conversation_id: UUID
    client_chunk_id: UUID
    ciphertext_base64: str = Field(min_length=1, max_length=700_000)


class HistoryChunkResponse(BaseModel):
    chunk_id: UUID
    server_sequence: int
    sender_device_id: UUID
    target_device_id: UUID
    conversation_id: UUID
    client_chunk_id: UUID
    ciphertext_base64: str
    created_at: datetime
    expires_at: datetime
    acknowledged_at: datetime | None


def history_chunk_response(chunk: DeviceHistoryChunk) -> HistoryChunkResponse:
    # Keep transport naming explicit instead of leaking a persistence object.
    if chunk.server_sequence is None:
        raise RuntimeError("persisted history chunk lacks a server sequence")
    return HistoryChunkResponse(
        chunk_id=chunk.id,
        server_sequence=chunk.server_sequence,
        sender_device_id=chunk.sender_device_id,
        target_device_id=chunk.target_device_id,
        conversation_id=chunk.conversation_id,
        client_chunk_id=chunk.client_chunk_id,
        ciphertext_base64=chunk.ciphertext_base64,
        created_at=chunk.created_at,
        expires_at=chunk.expires_at,
        acknowledged_at=chunk.acknowledged_at,
    )


def status_response(view: DevicePairingView) -> PairingStatusResponse:
    return PairingStatusResponse.model_validate(view, from_attributes=True)


def translate_pairing_error(error: Exception) -> HTTPException:
    if isinstance(error, (DevicePairingNotFoundError, DevicePairingProofError)):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="pairing not found")
    if isinstance(error, DevicePairingStateError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="pairing state conflict")
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="invalid pairing data",
    )


@router.post(
    "/{pairing_id}/history-chunks",
    response_model=HistoryChunkResponse,
)
async def upload_history_chunk(
    pairing_id: UUID,
    payload: UploadHistoryChunkBody,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[UploadHistoryChunk],
) -> HistoryChunkResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        chunk = await use_case.execute(
            UploadHistoryChunkCommand(
                pairing_id=pairing_id,
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
                target_device_id=payload.target_device_id,
                conversation_id=payload.conversation_id,
                client_chunk_id=payload.client_chunk_id,
                ciphertext_base64=payload.ciphertext_base64,
            )
        )
    except (DevicePairingNotFoundError, DevicePairingStateError, DomainValidationError) as error:
        raise translate_pairing_error(error) from error
    return history_chunk_response(chunk)


@router.get(
    "/{pairing_id}/history-chunks/outbound",
    response_model=list[HistoryChunkResponse],
)
async def list_outbound_history_chunks(
    pairing_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListOutboundHistoryChunks],
) -> list[HistoryChunkResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        chunks = await use_case.execute(
            ListHistoryChunksQuery(
                pairing_id=pairing_id,
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
                after_sequence=0,
            )
        )
    except DevicePairingNotFoundError as error:
        raise translate_pairing_error(error) from error
    return [history_chunk_response(chunk) for chunk in chunks]


@router.get(
    "/{pairing_id}/history-chunks",
    response_model=list[HistoryChunkResponse],
)
async def list_history_chunks(
    pairing_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListHistoryChunks],
    after_sequence: int = 0,
) -> list[HistoryChunkResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        chunks = await use_case.execute(
            ListHistoryChunksQuery(
                pairing_id=pairing_id,
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
                after_sequence=after_sequence,
            )
        )
    except (DevicePairingNotFoundError, DomainValidationError) as error:
        raise translate_pairing_error(error) from error
    return [history_chunk_response(chunk) for chunk in chunks]


@router.post(
    "/{pairing_id}/history-chunks/{chunk_id}/ack",
    response_model=HistoryChunkResponse,
)
async def acknowledge_history_chunk(
    pairing_id: UUID,
    chunk_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[AcknowledgeHistoryChunk],
) -> HistoryChunkResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        chunk = await use_case.execute(
            AcknowledgeHistoryChunkCommand(
                pairing_id=pairing_id,
                chunk_id=chunk_id,
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
            )
        )
    except DevicePairingNotFoundError as error:
        raise translate_pairing_error(error) from error
    return history_chunk_response(chunk)


@router.post("/requests", response_model=CreatePairingResponse)
async def create_pairing_request(
    payload: CreatePairingRequestBody,
    request: Request,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[CreatePairingRequest],
) -> CreatePairingResponse:
    require_allowed_origin(request, settings)
    try:
        result = await use_case.execute(
            CreatePairingRequestCommand(
                candidate_proof_hash=payload.candidate_proof_hash,
                candidate_device_name=payload.candidate_device_name,
            )
        )
    except DomainValidationError as error:
        raise translate_pairing_error(error) from error
    return CreatePairingResponse.model_validate(result, from_attributes=True)


@router.post("/offers", response_model=CreatePairingResponse)
async def create_pairing_offer(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[CreatePairingOffer],
) -> CreatePairingResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            CreatePairingOfferCommand(
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
            )
        )
    except DevicePairingNotFoundError as error:
        raise translate_pairing_error(error) from error
    return CreatePairingResponse.model_validate(result, from_attributes=True)


@router.post("/{pairing_id}/scan-request", response_model=PairingStatusResponse)
async def scan_pairing_request(
    pairing_id: UUID,
    payload: ScanPairingBody,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ScanPairingRequest],
) -> PairingStatusResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        view = await use_case.execute(
            ScanPairingRequestCommand(
                pairing_id=pairing_id,
                scan_token=payload.scan_token,
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
            )
        )
    except (DevicePairingNotFoundError, DevicePairingProofError, DevicePairingStateError) as error:
        raise translate_pairing_error(error) from error
    return status_response(view)


@router.post("/{pairing_id}/scan-offer", response_model=PairingStatusResponse)
async def scan_pairing_offer(
    pairing_id: UUID,
    payload: ScanOfferBody,
    request: Request,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[ScanPairingOffer],
) -> PairingStatusResponse:
    require_allowed_origin(request, settings)
    try:
        view = await use_case.execute(
            ScanPairingOfferCommand(
                pairing_id=pairing_id,
                scan_token=payload.scan_token,
                candidate_proof_hash=payload.candidate_proof_hash,
                candidate_device_name=payload.candidate_device_name,
            )
        )
    except (
        DevicePairingNotFoundError,
        DevicePairingProofError,
        DevicePairingStateError,
        DomainValidationError,
    ) as error:
        raise translate_pairing_error(error) from error
    return status_response(view)


@router.post("/{pairing_id}/candidate-status", response_model=PairingStatusResponse)
async def candidate_pairing_status(
    pairing_id: UUID,
    payload: CandidateProofBody,
    request: Request,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[GetCandidatePairingStatus],
) -> PairingStatusResponse:
    require_allowed_origin(request, settings)
    try:
        view = await use_case.execute(
            GetCandidatePairingStatusQuery(
                pairing_id=pairing_id,
                candidate_proof=payload.candidate_proof,
            )
        )
    except (DevicePairingNotFoundError, DevicePairingProofError) as error:
        raise translate_pairing_error(error) from error
    return status_response(view)


@router.get("/{pairing_id}/trusted-status", response_model=PairingStatusResponse)
async def trusted_pairing_status(
    pairing_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[GetTrustedPairingStatus],
) -> PairingStatusResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        view = await use_case.execute(
            GetTrustedPairingStatusQuery(
                pairing_id=pairing_id,
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
            )
        )
    except DevicePairingNotFoundError as error:
        raise translate_pairing_error(error) from error
    return status_response(view)


@router.post("/{pairing_id}/approve", response_model=PairingStatusResponse)
async def approve_pairing(
    pairing_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ApproveDevicePairing],
) -> PairingStatusResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        view = await use_case.execute(
            ApproveDevicePairingCommand(
                pairing_id=pairing_id,
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
            )
        )
    except (DevicePairingNotFoundError, DevicePairingStateError) as error:
        raise translate_pairing_error(error) from error
    return status_response(view)


@router.post("/{pairing_id}/authorize", response_model=SessionResponse)
async def authorize_pairing(
    pairing_id: UUID,
    payload: CandidateProofBody,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[AuthorizeDevicePairing],
) -> SessionResponse:
    require_allowed_origin(request, settings)
    try:
        result = await use_case.execute(
            AuthorizeDevicePairingCommand(
                pairing_id=pairing_id,
                candidate_proof=payload.candidate_proof,
                client_ip=client_ip(request, settings),
            )
        )
    except (DevicePairingNotFoundError, DevicePairingProofError, DevicePairingStateError) as error:
        raise translate_pairing_error(error) from error
    set_new_session_cookies(
        response,
        settings,
        result.session_credential,
        result.absolute_expires_at,
    )
    return SessionResponse(
        user_id=result.user_id,
        session_id=result.session_id,
        device_id=result.device_id,
        absolute_expires_at=result.absolute_expires_at,
    )


@router.post("/{pairing_id}/cancel-candidate", response_model=PairingStatusResponse)
async def cancel_candidate_pairing(
    pairing_id: UUID,
    payload: CandidateProofBody,
    request: Request,
    settings: FromDishka[AppSettings],
    use_case: FromDishka[CancelCandidatePairing],
) -> PairingStatusResponse:
    require_allowed_origin(request, settings)
    try:
        view = await use_case.execute(
            CancelCandidatePairingCommand(
                pairing_id=pairing_id,
                candidate_proof=payload.candidate_proof,
            )
        )
    except (DevicePairingNotFoundError, DevicePairingProofError) as error:
        raise translate_pairing_error(error) from error
    return status_response(view)


@router.post("/{pairing_id}/cancel-trusted", response_model=PairingStatusResponse)
async def cancel_trusted_pairing(
    pairing_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[CancelTrustedPairing],
) -> PairingStatusResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        view = await use_case.execute(
            CancelTrustedPairingCommand(
                pairing_id=pairing_id,
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
            )
        )
    except DevicePairingNotFoundError as error:
        raise translate_pairing_error(error) from error
    return status_response(view)
