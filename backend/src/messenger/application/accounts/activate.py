"""One-time account activation use case."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.errors import (
    AccountAlreadyActiveError,
    ActivationAlreadyUsedError,
    ActivationExpiredError,
    InvalidActivationSecretError,
)
from messenger.application.password_policy import validate_new_password
from messenger.application.ports.activation_secrets import ActivationSecretService
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.passwords import PasswordHasher


@dataclass(frozen=True, slots=True)
class ActivateAccountCommand:
    """Presented activation credential and the user's new password."""

    activation_secret: str
    password: str


@dataclass(frozen=True, slots=True)
class ActivateAccountResult:
    """Public activation outcome."""

    user_id: UUID
    activated_at: datetime


class ActivateAccount:
    """Consume one activation credential and set an Argon2id password hash."""

    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        secrets: ActivationSecretService,
        passwords: PasswordHasher,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._secrets = secrets
        self._passwords = passwords

    async def execute(self, command: ActivateAccountCommand) -> ActivateAccountResult:
        """Validate and atomically consume one activation credential."""
        validate_new_password(command.password)
        token_hash = self._secrets.digest(command.activation_secret)
        now = self._clock.now()

        async with self._unit_of_work() as uow:
            token = await uow.activation_tokens.get_by_hash_for_update(token_hash)
            if token is None:
                raise InvalidActivationSecretError("activation secret is invalid")
            if token.revoked_at is not None:
                raise InvalidActivationSecretError("activation secret is invalid")
            if token.used_at is not None:
                raise ActivationAlreadyUsedError("activation secret is already used")
            if token.is_expired(now):
                raise ActivationExpiredError("activation secret has expired")

            user = await uow.users.get_by_id(token.user_id, for_update=True)
            if user is None:
                raise InvalidActivationSecretError("activation secret is invalid")
            if user.is_active:
                raise AccountAlreadyActiveError("account is already active")

            password_hash = await self._passwords.hash(command.password)
            activated_user = user.activate(now)
            consumed_token = token.mark_used(now)

            await uow.users.activate(activated_user, password_hash)
            await uow.activation_tokens.update_lifecycle(consumed_token)
            await uow.commit()

        return ActivateAccountResult(user_id=user.id, activated_at=now)
