"""Opaque message envelope HTTP transport; this is not E2EE implementation."""

import base64
import binascii
from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    InvalidMessageEnvelopeError,
    MessageIdempotencyConflictError,
    MessageNotFoundError,
)
from messenger.application.messaging.delete_message import (
    DeleteMessageForEveryone,
    DeleteMessageForEveryoneCommand,
)
from messenger.application.messaging.list_messages import ListMessages, ListMessagesQuery
from messenger.application.messaging.send_message import (
    SendOpaqueMessage,
    SendOpaqueMessageCommand,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.entities import MessageDeletionReason
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


class SendOpaqueMessageResponse(BaseModel):
    message_id: UUID
    client_message_id: UUID
    conversation_id: UUID
    sender_user_id: UUID
    sender_device_id: UUID
    protocol_version: int
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


def decode_ciphertext(encoded: str) -> bytes:
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid message envelope",
        ) from error


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
    return [
        OpaqueMessageResponse(
            message_id=message.id,
            client_message_id=message.client_message_id,
            conversation_id=message.conversation_id,
            sender_user_id=message.sender_user_id,
            sender_device_id=message.sender_device_id,
            protocol_version=message.protocol_version,
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
        for message in messages
    ]
