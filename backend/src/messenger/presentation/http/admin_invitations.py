"""Administrator transport for standalone registration invitations."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

from messenger.application.accounts.create_registration_invitation import (
    CreateRegistrationInvitation,
    CreateRegistrationInvitationCommand,
)
from messenger.application.accounts.list_registration_invitations import (
    ListRegistrationInvitations,
    ListRegistrationInvitationsQuery,
)
from messenger.application.accounts.revoke_registration_invitation import (
    RevokeRegistrationInvitation,
    RevokeRegistrationInvitationCommand,
)
from messenger.application.errors import (
    AuthorizationDeniedError,
    RegistrationInvitationNotFoundError,
    RegistrationInvitationStateError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/admin/invitations",
    tags=["admin-invitations"],
    route_class=DishkaRoute,
)


class CreateRegistrationInvitationRequest(BaseModel):
    label: str | None = Field(default=None, max_length=80)


class CreateRegistrationInvitationResponse(BaseModel):
    invitation_id: UUID
    label: str | None
    activation_secret: str
    created_at: datetime
    expires_at: datetime


class RegistrationInvitationResponse(BaseModel):
    invitation_id: UUID
    label: str | None
    status: Literal["active", "used", "expired", "revoked"]
    created_by_username: str
    registered_user_id: UUID | None
    registered_username: str | None
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None


class RegistrationInvitationsPageResponse(BaseModel):
    items: list[RegistrationInvitationResponse]
    total: int
    limit: int
    offset: int


class RevokeRegistrationInvitationResponse(BaseModel):
    invitation_id: UUID
    revoked_at: datetime


def forbidden(error: AuthorizationDeniedError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")


@router.get("", response_model=RegistrationInvitationsPageResponse)
async def list_invitations(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListRegistrationInvitations],
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
) -> RegistrationInvitationsPageResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        page = await use_case.execute(
            ListRegistrationInvitationsQuery(
                actor_user_id=principal.user_id,
                limit=limit,
                offset=offset,
            )
        )
    except AuthorizationDeniedError as error:
        raise forbidden(error) from error
    return RegistrationInvitationsPageResponse(
        items=[
            RegistrationInvitationResponse.model_validate(item, from_attributes=True)
            for item in page.items
        ],
        total=page.total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "",
    response_model=CreateRegistrationInvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    payload: CreateRegistrationInvitationRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[CreateRegistrationInvitation],
) -> CreateRegistrationInvitationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            CreateRegistrationInvitationCommand(
                actor_user_id=principal.user_id,
                label=payload.label,
            )
        )
    except AuthorizationDeniedError as error:
        raise forbidden(error) from error
    except DomainValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid invitation data",
        ) from error
    return CreateRegistrationInvitationResponse.model_validate(result, from_attributes=True)


@router.post(
    "/{invitation_id}/revoke",
    response_model=RevokeRegistrationInvitationResponse,
)
async def revoke_invitation(
    invitation_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[RevokeRegistrationInvitation],
) -> RevokeRegistrationInvitationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            RevokeRegistrationInvitationCommand(
                actor_user_id=principal.user_id,
                invitation_id=invitation_id,
            )
        )
    except AuthorizationDeniedError as error:
        raise forbidden(error) from error
    except RegistrationInvitationNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found") from error
    except RegistrationInvitationStateError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="invitation is not active",
        ) from error
    return RevokeRegistrationInvitationResponse.model_validate(result, from_attributes=True)
