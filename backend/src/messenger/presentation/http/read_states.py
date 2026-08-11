"""Shared conversation read state HTTP transport."""

from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    InvalidReadSequenceError,
)
from messenger.application.messaging.list_read_states import (
    ListConversationReadStates,
    ListConversationReadStatesQuery,
)
from messenger.application.messaging.mark_read import (
    MarkConversationRead,
    MarkConversationReadCommand,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/conversation-read-states",
    tags=["conversation read states"],
    route_class=DishkaRoute,
)


class ConversationReadStateResponse(BaseModel):
    conversation_id: UUID
    last_read_sequence: int
    latest_sequence: int
    unread_count: int


class MarkConversationReadRequest(BaseModel):
    sequence: int = Field(ge=1)


class MarkConversationReadResponse(BaseModel):
    conversation_id: UUID
    last_read_sequence: int
    updated_at: datetime
    advanced: bool


@router.get("", response_model=list[ConversationReadStateResponse])
async def list_read_states(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListConversationReadStates],
) -> list[ConversationReadStateResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    results = await use_case.execute(ListConversationReadStatesQuery(principal.user_id))
    return [
        ConversationReadStateResponse.model_validate(item, from_attributes=True) for item in results
    ]


@router.put("/{conversation_id}", response_model=MarkConversationReadResponse)
async def mark_read(
    conversation_id: UUID,
    payload: MarkConversationReadRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[MarkConversationRead],
) -> MarkConversationReadResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            MarkConversationReadCommand(
                actor_user_id=principal.user_id,
                conversation_id=conversation_id,
                sequence=payload.sequence,
            )
        )
    except ConversationNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="conversation not found",
        ) from error
    except AuthorizationDeniedError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden") from error
    except InvalidReadSequenceError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid read sequence",
        ) from error
    return MarkConversationReadResponse.model_validate(result, from_attributes=True)
