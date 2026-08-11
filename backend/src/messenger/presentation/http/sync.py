"""Durable offline catch-up HTTP transport."""

from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from messenger.application.errors import InvalidMessageEnvelopeError
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.application.sync import SyncEventType
from messenger.application.sync.list_events import (
    ListSyncEvents,
    ListSyncEventsQuery,
)
from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.auth import authenticate_request

router = APIRouter(prefix="/api/v1/sync", tags=["sync"], route_class=DishkaRoute)


class SyncEventResponse(BaseModel):
    event_id: UUID
    cursor: int
    event_type: SyncEventType
    conversation_id: UUID
    message_id: UUID | None
    created_at: datetime


class SyncPageResponse(BaseModel):
    events: list[SyncEventResponse]
    next_cursor: int
    stream_cursor: int
    has_more: bool
    reset_required: bool


@router.get("", response_model=SyncPageResponse)
async def list_sync_events(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListSyncEvents],
    after: int = 0,
    limit: int = 100,
) -> SyncPageResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(ListSyncEventsQuery(principal.user_id, after, limit))
    except InvalidMessageEnvelopeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid sync cursor",
        ) from error
    return SyncPageResponse(
        events=[
            SyncEventResponse(
                event_id=event.event_id,
                cursor=event.cursor,
                event_type=event.event_type,
                conversation_id=event.conversation_id,
                message_id=event.message_id,
                created_at=event.created_at,
            )
            for event in result.events
        ],
        next_cursor=result.next_cursor,
        stream_cursor=result.stream_cursor,
        has_more=result.has_more,
        reset_required=result.reset_required,
    )
