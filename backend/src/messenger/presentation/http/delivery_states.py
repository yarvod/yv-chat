"""Per-device delivery state HTTP transport."""

from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    InvalidDeliverySequenceError,
)
from messenger.application.messaging.list_delivery_states import (
    ListParticipantDeliveryStates,
    ListParticipantDeliveryStatesQuery,
)
from messenger.application.messaging.mark_delivered import (
    MarkConversationDelivered,
    MarkConversationDeliveredCommand,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/conversation-delivery-states",
    tags=["conversation delivery states"],
    route_class=DishkaRoute,
)


class ParticipantDeliveryStateResponse(BaseModel):
    conversation_id: UUID
    user_id: UUID
    delivered_sequence: int
    read_sequence: int


class MarkConversationDeliveredRequest(BaseModel):
    sequence: int = Field(ge=1)


class MarkConversationDeliveredResponse(BaseModel):
    conversation_id: UUID
    last_delivered_sequence: int
    updated_at: datetime
    advanced: bool


@router.get("", response_model=list[ParticipantDeliveryStateResponse])
async def list_delivery_states(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListParticipantDeliveryStates],
) -> list[ParticipantDeliveryStateResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    results = await use_case.execute(ListParticipantDeliveryStatesQuery(principal.user_id))
    return [
        ParticipantDeliveryStateResponse.model_validate(item, from_attributes=True)
        for item in results
    ]


@router.put("/{conversation_id}", response_model=MarkConversationDeliveredResponse)
async def mark_delivered(
    conversation_id: UUID,
    payload: MarkConversationDeliveredRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[MarkConversationDelivered],
) -> MarkConversationDeliveredResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            MarkConversationDeliveredCommand(
                actor_user_id=principal.user_id,
                actor_device_id=principal.device_id,
                conversation_id=conversation_id,
                sequence=payload.sequence,
            )
        )
    except ConversationNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found") from error
    except AuthorizationDeniedError as error:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden") from error
    except InvalidDeliverySequenceError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid delivery sequence"
        ) from error
    return MarkConversationDeliveredResponse.model_validate(result, from_attributes=True)
