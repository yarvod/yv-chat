"""Versioned conversation and membership HTTP transport."""

from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.conversations.add_member import (
    AddConversationMember,
    AddConversationMemberCommand,
)
from messenger.application.conversations.change_member_role import (
    ChangeConversationMemberRole,
    ChangeConversationMemberRoleCommand,
)
from messenger.application.conversations.create_direct import (
    CreateDirectConversation,
    CreateDirectConversationCommand,
)
from messenger.application.conversations.create_group import (
    CreateGroupConversation,
    CreateGroupConversationCommand,
)
from messenger.application.conversations.dto import ConversationResult
from messenger.application.conversations.get_conversation import (
    GetConversation,
    GetConversationQuery,
)
from messenger.application.conversations.leave_conversation import (
    LeaveConversation,
    LeaveConversationCommand,
)
from messenger.application.conversations.list_conversations import (
    ListConversations,
    ListConversationsQuery,
)
from messenger.application.conversations.remove_member import (
    RemoveConversationMember,
    RemoveConversationMemberCommand,
)
from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationMembershipConflictError,
    ConversationNotFoundError,
    ConversationParticipantNotFoundError,
    DuplicateDirectConversationError,
    SessionNotAuthenticatedError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.entities import ConversationMemberRole, ConversationType
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/conversations",
    tags=["conversations"],
    route_class=DishkaRoute,
)


class ConversationMemberResponse(BaseModel):
    user_id: UUID
    username: str
    display_name: str
    role: ConversationMemberRole
    joined_at: datetime
    left_at: datetime | None


class ConversationResponse(BaseModel):
    conversation_id: UUID
    conversation_type: ConversationType
    title: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    members: list[ConversationMemberResponse]


class CreateDirectConversationRequest(BaseModel):
    other_user_id: UUID


class CreateGroupConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    member_user_ids: list[UUID] = Field(default_factory=list, max_length=50)


class AddConversationMemberRequest(BaseModel):
    user_id: UUID


class ChangeConversationMemberRoleRequest(BaseModel):
    role: ConversationMemberRole


def response_from(result: ConversationResult) -> ConversationResponse:
    return ConversationResponse.model_validate(result, from_attributes=True)


def translate_conversation_error(error: Exception) -> HTTPException:
    if isinstance(error, SessionNotAuthenticatedError):
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    if isinstance(error, ConversationNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="conversation not found",
        )
    if isinstance(error, ConversationParticipantNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="participant not found",
        )
    if isinstance(error, AuthorizationDeniedError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
    if isinstance(
        error,
        (DuplicateDirectConversationError, ConversationMembershipConflictError),
    ):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="membership conflict")
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="invalid conversation data",
    )


CONVERSATION_ERRORS = (
    SessionNotAuthenticatedError,
    ConversationNotFoundError,
    ConversationParticipantNotFoundError,
    AuthorizationDeniedError,
    DuplicateDirectConversationError,
    ConversationMembershipConflictError,
    DomainValidationError,
)


@router.get("", response_model=list[ConversationResponse])
async def list_conversations(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListConversations],
) -> list[ConversationResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        results = await use_case.execute(ListConversationsQuery(actor_user_id=principal.user_id))
    except CONVERSATION_ERRORS as error:
        raise translate_conversation_error(error) from error
    return [response_from(result) for result in results]


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[GetConversation],
) -> ConversationResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(GetConversationQuery(principal.user_id, conversation_id))
    except CONVERSATION_ERRORS as error:
        raise translate_conversation_error(error) from error
    return response_from(result)


@router.post("/direct", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_direct_conversation(
    payload: CreateDirectConversationRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[CreateDirectConversation],
) -> ConversationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            CreateDirectConversationCommand(principal.user_id, payload.other_user_id)
        )
    except CONVERSATION_ERRORS as error:
        raise translate_conversation_error(error) from error
    return response_from(result)


@router.post("/group", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_group_conversation(
    payload: CreateGroupConversationRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[CreateGroupConversation],
) -> ConversationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            CreateGroupConversationCommand(
                principal.user_id,
                payload.title,
                tuple(payload.member_user_ids),
            )
        )
    except CONVERSATION_ERRORS as error:
        raise translate_conversation_error(error) from error
    return response_from(result)


@router.post("/{conversation_id}/members", response_model=ConversationResponse)
async def add_conversation_member(
    conversation_id: UUID,
    payload: AddConversationMemberRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[AddConversationMember],
) -> ConversationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            AddConversationMemberCommand(
                principal.user_id,
                conversation_id,
                payload.user_id,
            )
        )
    except CONVERSATION_ERRORS as error:
        raise translate_conversation_error(error) from error
    return response_from(result)


@router.delete("/{conversation_id}/members/{user_id}", response_model=ConversationResponse)
async def remove_conversation_member(
    conversation_id: UUID,
    user_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[RemoveConversationMember],
) -> ConversationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            RemoveConversationMemberCommand(principal.user_id, conversation_id, user_id)
        )
    except CONVERSATION_ERRORS as error:
        raise translate_conversation_error(error) from error
    return response_from(result)


@router.patch("/{conversation_id}/members/{user_id}", response_model=ConversationResponse)
async def change_conversation_member_role(
    conversation_id: UUID,
    user_id: UUID,
    payload: ChangeConversationMemberRoleRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ChangeConversationMemberRole],
) -> ConversationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            ChangeConversationMemberRoleCommand(
                principal.user_id,
                conversation_id,
                user_id,
                payload.role,
            )
        )
    except CONVERSATION_ERRORS as error:
        raise translate_conversation_error(error) from error
    return response_from(result)


@router.post("/{conversation_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_conversation(
    conversation_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[LeaveConversation],
) -> None:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        await use_case.execute(LeaveConversationCommand(principal.user_id, conversation_id))
    except CONVERSATION_ERRORS as error:
        raise translate_conversation_error(error) from error
