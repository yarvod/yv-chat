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
)
from messenger.application.messaging.send_message import (
    SendOpaqueMessage,
    SendOpaqueMessageCommand,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/conversations/{conversation_id}/messages",
    tags=["messages"],
    route_class=DishkaRoute,
)


class SendOpaqueMessageRequest(BaseModel):
    protocol_version: int = Field(ge=1, le=32_767)
    ciphertext_base64: str = Field(min_length=1, max_length=87_384)


class SendOpaqueMessageResponse(BaseModel):
    message_id: UUID
    conversation_id: UUID
    sender_user_id: UUID
    sender_device_id: UUID
    protocol_version: int
    created_at: datetime


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
    return SendOpaqueMessageResponse.model_validate(result, from_attributes=True)
