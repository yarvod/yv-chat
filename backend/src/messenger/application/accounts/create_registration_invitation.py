"""Create one standalone administrator-managed registration invitation."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from messenger.application.accounts.authorization import require_active_admin
from messenger.application.ports.activation_secrets import ActivationSecretService
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.domain.entities import RegistrationInvitation


@dataclass(frozen=True, slots=True)
class CreateRegistrationInvitationCommand:
    actor_user_id: UUID
    label: str | None = None


@dataclass(frozen=True, slots=True)
class CreateRegistrationInvitationResult:
    invitation_id: UUID
    label: str | None
    activation_secret: str
    created_at: datetime
    expires_at: datetime


class CreateRegistrationInvitation:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        secrets: ActivationSecretService,
        activation_ttl: timedelta,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._secrets = secrets
        self._activation_ttl = activation_ttl

    async def execute(
        self,
        command: CreateRegistrationInvitationCommand,
    ) -> CreateRegistrationInvitationResult:
        now = self._clock.now()
        generated = self._secrets.generate()
        invitation = RegistrationInvitation.create(
            token_hash=generated.digest,
            label=command.label,
            created_by_user_id=command.actor_user_id,
            created_at=now,
            expires_at=now + self._activation_ttl,
        )
        async with self._unit_of_work() as uow:
            await require_active_admin(uow.users, command.actor_user_id)
            await uow.registration_invitations.add(invitation)
            await uow.commit()
        return CreateRegistrationInvitationResult(
            invitation_id=invitation.id,
            label=invitation.label,
            activation_secret=generated.plaintext,
            created_at=invitation.created_at,
            expires_at=invitation.expires_at,
        )
