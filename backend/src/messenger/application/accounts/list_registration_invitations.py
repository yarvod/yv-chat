"""List safe administrator-visible registration invitation metadata."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from messenger.application.accounts.authorization import require_active_admin
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.domain.entities import RegistrationInvitation

RegistrationInvitationStatus = Literal["active", "used", "expired", "revoked"]


@dataclass(frozen=True, slots=True)
class ListRegistrationInvitationsQuery:
    actor_user_id: UUID
    limit: int = 20
    offset: int = 0


@dataclass(frozen=True, slots=True)
class RegistrationInvitationItem:
    invitation_id: UUID
    label: str | None
    status: RegistrationInvitationStatus
    created_by_username: str
    registered_user_id: UUID | None
    registered_username: str | None
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None


@dataclass(frozen=True, slots=True)
class RegistrationInvitationPage:
    items: list[RegistrationInvitationItem]
    total: int
    limit: int
    offset: int


def invitation_status(
    invitation: RegistrationInvitation,
    now: datetime,
) -> RegistrationInvitationStatus:
    if invitation.used_at is not None:
        return "used"
    if invitation.revoked_at is not None:
        return "revoked"
    if invitation.is_expired(now):
        return "expired"
    return "active"


class ListRegistrationInvitations:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(
        self,
        query: ListRegistrationInvitationsQuery,
    ) -> RegistrationInvitationPage:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            await require_active_admin(uow.users, query.actor_user_id)
            invitations, total = await uow.registration_invitations.list_recent(
                limit=query.limit,
                offset=query.offset,
            )
            user_ids = {item.created_by_user_id for item in invitations}
            user_ids.update(
                item.registered_user_id
                for item in invitations
                if item.registered_user_id is not None
            )
            users = {user.id: user for user in await uow.users.get_many_by_ids(user_ids)}

        items: list[RegistrationInvitationItem] = []
        for invitation in invitations:
            creator = users.get(invitation.created_by_user_id)
            if creator is None:
                raise RuntimeError("registration invitation creator disappeared")
            registered = (
                users.get(invitation.registered_user_id)
                if invitation.registered_user_id is not None
                else None
            )
            items.append(
                RegistrationInvitationItem(
                    invitation_id=invitation.id,
                    label=invitation.label,
                    status=invitation_status(invitation, now),
                    created_by_username=creator.username,
                    registered_user_id=invitation.registered_user_id,
                    registered_username=registered.username if registered is not None else None,
                    created_at=invitation.created_at,
                    expires_at=invitation.expires_at,
                    used_at=invitation.used_at,
                    revoked_at=invitation.revoked_at,
                )
            )
        return RegistrationInvitationPage(
            items=items,
            total=total,
            limit=query.limit,
            offset=query.offset,
        )
