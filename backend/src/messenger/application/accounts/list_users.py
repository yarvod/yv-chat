"""List accounts visible to an active administrator."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.accounts.authorization import require_active_admin
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ListManagedUsersQuery:
    actor_user_id: UUID
    search: str | None = None
    limit: int = 20
    offset: int = 0


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
    active_sessions: int


@dataclass(frozen=True, slots=True)
class ManagedUsersPage:
    items: list[ManagedUserItem]
    total: int
    limit: int
    offset: int


class ListManagedUsers:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, query: ListManagedUsersQuery) -> ManagedUsersPage:
        if not 1 <= query.limit <= 50:
            raise ValueError("managed user page limit must be between 1 and 50")
        if query.offset < 0:
            raise ValueError("managed user page offset cannot be negative")
        search = query.search.strip() if query.search is not None else None
        if search == "":
            search = None
        if search is not None and len(search) > 80:
            raise ValueError("managed user search is too long")
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            await require_active_admin(uow.users, query.actor_user_id)
            page = await uow.users.list_managed(
                search=search,
                limit=query.limit,
                offset=query.offset,
            )
            active_sessions = await uow.sessions.count_active_for_users(
                {record.user.id for record in page.items},
                now=now,
            )

        return ManagedUsersPage(
            items=[
                ManagedUserItem(
                    user_id=record.user.id,
                    username=record.user.username,
                    display_name=record.user.display_name,
                    is_admin=record.user.is_admin,
                    is_active=record.user.is_active,
                    activation_pending=(
                        not record.user.is_active and not record.password_configured
                    ),
                    can_reactivate=(not record.user.is_active and record.password_configured),
                    created_at=record.user.created_at,
                    updated_at=record.user.updated_at,
                    active_sessions=active_sessions.get(record.user.id, 0),
                )
                for record in page.items
            ],
            total=page.total,
            limit=query.limit,
            offset=query.offset,
        )
