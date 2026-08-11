"""Minimal authenticated participant directory HTTP transport."""

from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from messenger.application.accounts.list_directory import (
    ListUserDirectory,
    ListUserDirectoryQuery,
)
from messenger.application.errors import SessionNotAuthenticatedError
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.auth import authenticate_request

router = APIRouter(prefix="/api/v1/users", tags=["users"], route_class=DishkaRoute)


class UserDirectoryResponse(BaseModel):
    user_id: UUID
    username: str
    display_name: str


@router.get("", response_model=list[UserDirectoryResponse])
async def list_user_directory(
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[ListUserDirectory],
) -> list[UserDirectoryResponse]:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        items = await use_case.execute(ListUserDirectoryQuery(principal.user_id))
    except SessionNotAuthenticatedError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unauthorized",
        ) from error
    return [UserDirectoryResponse.model_validate(item, from_attributes=True) for item in items]
