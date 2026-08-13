"""Revoke one active registration invitation."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.accounts.authorization import require_active_admin
from messenger.application.errors import (
    RegistrationInvitationNotFoundError,
    RegistrationInvitationStateError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class RevokeRegistrationInvitationCommand:
    actor_user_id: UUID
    invitation_id: UUID


@dataclass(frozen=True, slots=True)
class RevokeRegistrationInvitationResult:
    invitation_id: UUID
    revoked_at: datetime


class RevokeRegistrationInvitation:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(
        self,
        command: RevokeRegistrationInvitationCommand,
    ) -> RevokeRegistrationInvitationResult:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            await require_active_admin(uow.users, command.actor_user_id)
            invitation = await uow.registration_invitations.get_by_id_for_update(
                command.invitation_id
            )
            if invitation is None:
                raise RegistrationInvitationNotFoundError("invitation was not found")
            revoked = invitation.revoke(now)
            if revoked.revoked_at is None:
                raise RegistrationInvitationStateError("invitation is not active")
            await uow.registration_invitations.update_lifecycle(revoked)
            await uow.commit()
        return RevokeRegistrationInvitationResult(
            invitation_id=revoked.id,
            revoked_at=revoked.revoked_at,
        )
