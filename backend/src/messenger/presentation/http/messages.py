"""Opaque message envelope HTTP transport; this is not E2EE implementation."""

import base64
import binascii
from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.errors import (
    AttachmentConflictError,
    AuthorizationDeniedError,
    ConversationCryptoNotReadyError,
    ConversationNotFoundError,
    InvalidAttachmentError,
    InvalidMessageEnvelopeError,
    MessageIdempotencyConflictError,
    MessageNotFoundError,
)
from messenger.application.messaging.delete_message import (
    DeleteMessageForEveryone,
    DeleteMessageForEveryoneCommand,
)
from messenger.application.messaging.get_message import GetMessage, GetMessageQuery
from messenger.application.messaging.list_message_history import (
    ListMessageHistory,
    ListMessageHistoryQuery,
)
from messenger.application.messaging.list_messages import ListMessages, ListMessagesQuery
from messenger.application.messaging.send_message import (
    SendOpaqueMessage,
    SendOpaqueMessageCommand,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.entities import Message, MessageDeletionReason
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/conversations/{conversation_id}/messages",
    tags=["messages"],
    route_class=DishkaRoute,
)


class SendOpaqueMessageRequest(BaseModel):
    client_message_id: UUID
    protocol_version: int = Field(ge=1, le=32_767)
    ciphertext_base64: str = Field(min_length=1, max_length=87_384)
    crypto_generation_id: UUID | None = None
    crypto_epoch: int | None = Field(default=None, gt=0)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=10)


class SendOpaqueMessageResponse(BaseModel):
    message_id: UUID
    client_message_id: UUID
    conversation_id: UUID
    sender_user_id: UUID
    sender_device_id: UUID
    protocol_version: int
    crypto_generation_id: UUID | None
    crypto_epoch: int | None
    sequence: int
    created_at: datetime
    expires_at: datetime


class OpaqueMessageResponse(SendOpaqueMessageResponse):
    ciphertext_base64: str | None
    deletion_reason: MessageDeletionReason | None
    deleted_at: datetime | None


class DeleteMessageResponse(BaseModel):
    message_id: UUID
    conversation_id: UUID
    sequence: int
    deletion_reason: MessageDeletionReason
    deleted_at: datetime
    advanced: bool


class MessageHistoryPageResponse(BaseModel):
    messages: list[OpaqueMessageResponse]
    has_more: bool
    oldest_sequence: int | None
    newest_sequence: int | None


def decode_ciphertext(encoded: str) -> bytes:
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid message envelope",
        ) from error


def serialize_message(message: Message) -> OpaqueMessageResponse:
    return OpaqueMessageResponse(
        message_id=message.id,
        client_message_id=message.client_message_id,
        conversation_id=message.conversation_id,
        sender_user_id=message.sender_user_id,
        sender_device_id=message.sender_device_id,
        protocol_version=message.protocol_version,
        crypto_generation_id=message.crypto_generation_id,
        crypto_epoch=message.crypto_epoch,
        sequence=message.sequence,
        created_at=message.created_at,
        expires_at=message.expires_at,
        ciphertext_base64=(
            base64.b64encode(message.ciphertext).decode()
            if message.ciphertext is not None
            else None
        ),
        deletion_reason=message.deletion_reason,
        deleted_at=message.deleted_at,
    )


@router.post("", response_model=SendOpaqueMessageResponse, status_code=status.HTTP_201_CREATED)
async def send_opaque_message(
    conversation_id: UUID,
    payload: SendOpaqueMessageRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[SendOpaqueMessage],
) -> SendOpaqueMessageResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            SendOpaqueMessageCommand(
                actor_user_id=principal.user_id,
                actor_device_id=principal.device_id,
                conversation_id=conversation_id,
                client_message_id=payload.client_message_id,
                protocol_version=payload.protocol_version,
                ciphertext=decode_ciphertext(payload.ciphertext_base64),
                attachment_ids=tuple(payload.attachment_ids),
                crypto_generation_id=payload.crypto_generation_id,
                crypto_epoch=payload.crypto_epoch,
            )
        )
    except ConversationNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="conversation not found",
        ) from error
    except AuthorizationDeniedError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden") from error
    except InvalidMessageEnvelopeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid message envelope",
        ) from error
    except MessageIdempotencyConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="client message id conflict",
        ) from error
    except AttachmentConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="attachment conflict",
        ) from error
    except InvalidAttachmentError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid attachment selection",
        ) from error
    except ConversationCryptoNotReadyError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="conversation encryption is not ready",
        ) from error
    return SendOpaqueMessageResponse.model_validate(result, from_attributes=True)


@router.delete("/{message_id}", response_model=DeleteMessageResponse)
async def delete_message_for_everyone(
    conversation_id: UUID,
    message_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[DeleteMessageForEveryone],
) -> DeleteMessageResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            DeleteMessageForEveryoneCommand(
                actor_user_id=principal.user_id,
                conversation_id=conversation_id,
                message_id=message_id,
            )
        )
    except ConversationNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found") from error
    except MessageNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "message not found") from error
    except AuthorizationDeniedError as error:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden") from error
    return DeleteMessageResponse.model_validate(result, from_attributes=True)


@router.get("/history", response_model=MessageHistoryPageResponse)
async def list_message_history(
    conversation_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListMessageHistory],
    before_sequence: int | None = None,
    limit: int = 50,
) -> MessageHistoryPageResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        page = await use_case.execute(
            ListMessageHistoryQuery(
                actor_user_id=principal.user_id,
                conversation_id=conversation_id,
                before_sequence=before_sequence,
                limit=limit,
            )
        )
    except ConversationNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="conversation not found",
        ) from error
    except InvalidMessageEnvelopeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid message history page",
        ) from error
    return MessageHistoryPageResponse(
        messages=[serialize_message(message) for message in page.messages],
        has_more=page.has_more,
        oldest_sequence=page.oldest_sequence,
        newest_sequence=page.newest_sequence,
    )


@router.get("/{message_id}", response_model=OpaqueMessageResponse)
async def get_opaque_message(
    conversation_id: UUID,
    message_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[GetMessage],
) -> OpaqueMessageResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        message = await use_case.execute(
            GetMessageQuery(
                actor_user_id=principal.user_id,
                conversation_id=conversation_id,
                message_id=message_id,
            )
        )
    except ConversationNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found") from error
    except MessageNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "message not found") from error
    return serialize_message(message)


@router.get("", response_model=list[OpaqueMessageResponse])
async def list_opaque_messages(
    conversation_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListMessages],
    after_sequence: int = 0,
    limit: int = 50,
) -> list[OpaqueMessageResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        messages = await use_case.execute(
            ListMessagesQuery(
                actor_user_id=principal.user_id,
                conversation_id=conversation_id,
                after_sequence=after_sequence,
                limit=limit,
            )
        )
    except ConversationNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="conversation not found",
        ) from error
    except InvalidMessageEnvelopeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid message page",
        ) from error
    return [serialize_message(message) for message in messages]
