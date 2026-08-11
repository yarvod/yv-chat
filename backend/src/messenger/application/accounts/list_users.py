"""List accounts visible to an active administrator."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.accounts.authorization import require_active_admin
from messenger.application.ports.identity import IdentityUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ListManagedUsersQuery:
    actor_user_id: UUID


@dataclass(frozen=True, slots=True)
class ManagedUserItem:
    user_id: UUID
    username: str
    display_name: str
    is_admin: bool
    is_active: bool
    activation_pending: bool
    can_reactivate: bool
    created_at: datetime
    updated_at: datetime


class ListManagedUsers:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: ListManagedUsersQuery) -> list[ManagedUserItem]:
        async with self._unit_of_work() as uow:
            await require_active_admin(uow.users, query.actor_user_id)
            records = await uow.users.list_managed()

        return [
            ManagedUserItem(
                user_id=record.user.id,
                username=record.user.username,
                display_name=record.user.display_name,
                is_admin=record.user.is_admin,
                is_active=record.user.is_active,
                activation_pending=(not record.user.is_active and not record.password_configured),
                can_reactivate=(not record.user.is_active and record.password_configured),
                created_at=record.user.created_at,
                updated_at=record.user.updated_at,
            )
            for record in records
        ]
