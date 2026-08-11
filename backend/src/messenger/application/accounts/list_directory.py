"""List the minimal active-user directory visible to authenticated users."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.errors import SessionNotAuthenticatedError
from messenger.application.ports.identity import IdentityUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ListUserDirectoryQuery:
    actor_user_id: UUID


@dataclass(frozen=True, slots=True)
class UserDirectoryItem:
    user_id: UUID
    username: str
    display_name: str


class ListUserDirectory:
    """Return only public identity fields for active messenger participants."""

    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: ListUserDirectoryQuery) -> list[UserDirectoryItem]:
        async with self._unit_of_work() as unit_of_work:
            actor = await unit_of_work.users.get_by_id(query.actor_user_id)
            if actor is None or not actor.is_active:
                raise SessionNotAuthenticatedError("current account is unavailable")
            users = await unit_of_work.users.list_active()

        return [
            UserDirectoryItem(
                user_id=user.id,
                username=user.username,
                display_name=user.display_name,
            )
            for user in users
        ]
