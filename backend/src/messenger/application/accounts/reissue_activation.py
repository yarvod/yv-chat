"""Atomically replace activation credentials for an invited account."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from messenger.application.accounts.authorization import require_active_admin
from messenger.application.errors import AccountAlreadyActiveError, ManagedUserNotFoundError
from messenger.application.ports.activation_secrets import ActivationSecretService
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.domain.entities import ActivationToken


@dataclass(frozen=True, slots=True)
class ReissueActivationCommand:
    actor_user_id: UUID
    target_user_id: UUID


@dataclass(frozen=True, slots=True)
class ReissueActivationResult:
    user_id: UUID
    activation_secret: str
    expires_at: datetime


class ReissueActivation:
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

    async def execute(self, command: ReissueActivationCommand) -> ReissueActivationResult:
        now = self._clock.now()
        generated = self._secrets.generate()
        expires_at = now + self._activation_ttl

        async with self._unit_of_work() as uow:
            await require_active_admin(uow.users, command.actor_user_id)
            old_tokens = await uow.activation_tokens.list_unconsumed_for_user_for_update(
                command.target_user_id
            )
            target = await uow.users.get_managed_by_id(
                command.target_user_id,
                for_update=True,
            )
            if target is None:
                raise ManagedUserNotFoundError("managed user was not found")
            if target.user.is_active or target.password_configured:
                raise AccountAlreadyActiveError("account is already activated")

            for token in old_tokens:
                await uow.activation_tokens.update_lifecycle(token.revoke(now))
            await uow.activation_tokens.add(
                ActivationToken.create(
                    user_id=target.user.id,
                    token_hash=generated.digest,
                    created_at=now,
                    expires_at=expires_at,
                )
            )
            await uow.commit()

        return ReissueActivationResult(
            user_id=target.user.id,
            activation_secret=generated.plaintext,
            expires_at=expires_at,
        )
