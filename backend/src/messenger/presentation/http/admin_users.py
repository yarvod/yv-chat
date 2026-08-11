"""Administrator-only closed user lifecycle HTTP transport."""

from datetime import datetime
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, model_validator

from messenger.application.accounts.invite import (
    CreateUserInvitation,
    CreateUserInvitationCommand,
)
from messenger.application.accounts.list_users import ListManagedUsers, ListManagedUsersQuery
from messenger.application.accounts.reissue_activation import (
    ReissueActivation,
    ReissueActivationCommand,
)
from messenger.application.accounts.update_user import (
    UpdateManagedUser,
    UpdateManagedUserCommand,
)
from messenger.application.errors import (
    AccountActivationRequiredError,
    AccountAlreadyActiveError,
    AuthorizationDeniedError,
    DuplicateUsernameError,
    ManagedUserNotFoundError,
    SelfDeactivationError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.exceptions import DomainValidationError
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/admin/users",
    tags=["admin-users"],
    route_class=DishkaRoute,
)


class ManagedUserResponse(BaseModel):
    user_id: UUID
    username: str
    display_name: str
    is_admin: bool
    is_active: bool
    activation_pending: bool
    can_reactivate: bool
    created_at: datetime
    updated_at: datetime


class CreateInvitationRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    display_name: str = Field(min_length=1, max_length=80)


class InvitationResponse(BaseModel):
    user_id: UUID
    username: str
    display_name: str
    activation_secret: str
    expires_at: datetime


class UpdateManagedUserRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    is_active: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> "UpdateManagedUserRequest":
        if self.display_name is None and self.is_active is None:
            raise ValueError("at least one field is required")
        return self


class UpdateManagedUserResponse(BaseModel):
    user_id: UUID
    display_name: str
    is_active: bool
    activation_pending: bool
    can_reactivate: bool
    revoked_sessions: int


class ReissueActivationResponse(BaseModel):
    user_id: UUID
    activation_secret: str
    expires_at: datetime


def forbidden(error: AuthorizationDeniedError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")


@router.get("", response_model=list[ManagedUserResponse])
async def list_users(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListManagedUsers],
) -> list[ManagedUserResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        users = await use_case.execute(ListManagedUsersQuery(actor_user_id=principal.user_id))
    except AuthorizationDeniedError as error:
        raise forbidden(error) from error
    return [ManagedUserResponse.model_validate(user, from_attributes=True) for user in users]


@router.post("", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    payload: CreateInvitationRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[CreateUserInvitation],
) -> InvitationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            CreateUserInvitationCommand(
                actor_user_id=principal.user_id,
                username=payload.username,
                display_name=payload.display_name,
            )
        )
    except AuthorizationDeniedError as error:
        raise forbidden(error) from error
    except DuplicateUsernameError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="username unavailable",
        ) from error
    except DomainValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid user data",
        ) from error
    return InvitationResponse.model_validate(result, from_attributes=True)


@router.patch("/{user_id}", response_model=UpdateManagedUserResponse)
async def update_user(
    user_id: UUID,
    payload: UpdateManagedUserRequest,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[UpdateManagedUser],
) -> UpdateManagedUserResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            UpdateManagedUserCommand(
                actor_user_id=principal.user_id,
                target_user_id=user_id,
                display_name=payload.display_name,
                is_active=payload.is_active,
            )
        )
    except AuthorizationDeniedError as error:
        raise forbidden(error) from error
    except ManagedUserNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="user not found",
        ) from error
    except SelfDeactivationError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="current administrator cannot be deactivated",
        ) from error
    except AccountActivationRequiredError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="account activation is required",
        ) from error
    except DomainValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid user data",
        ) from error
    return UpdateManagedUserResponse.model_validate(result, from_attributes=True)


@router.post("/{user_id}/activation-secret", response_model=ReissueActivationResponse)
async def reissue_activation(
    user_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ReissueActivation],
) -> ReissueActivationResponse:
    require_csrf(request, settings)
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            ReissueActivationCommand(
                actor_user_id=principal.user_id,
                target_user_id=user_id,
            )
        )
    except AuthorizationDeniedError as error:
        raise forbidden(error) from error
    except ManagedUserNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="user not found",
        ) from error
    except AccountAlreadyActiveError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="account is already activated",
        ) from error
    return ReissueActivationResponse.model_validate(result, from_attributes=True)
