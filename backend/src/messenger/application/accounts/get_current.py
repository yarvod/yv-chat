"""Read the current account through an authenticated principal."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.errors import SessionNotAuthenticatedError
from messenger.application.ports.identity import IdentityUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class GetCurrentAccountQuery:
    user_id: UUID


@dataclass(frozen=True, slots=True)
class CurrentAccountResult:
    user_id: UUID
    username: str
    display_name: str
    is_admin: bool
    created_at: datetime
    updated_at: datetime


class GetCurrentAccount:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: GetCurrentAccountQuery) -> CurrentAccountResult:
        async with self._unit_of_work() as unit_of_work:
            user = await unit_of_work.users.get_by_id(query.user_id)
        if user is None or not user.is_active:
            raise SessionNotAuthenticatedError("current account is unavailable")
        return CurrentAccountResult(
            user_id=user.id,
            username=user.username,
            display_name=user.display_name,
            is_admin=user.is_admin,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )
