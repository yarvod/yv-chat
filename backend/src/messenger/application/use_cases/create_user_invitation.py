"""Admin-controlled user invitation use case."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from messenger.application.errors import (
    AuthorizationDeniedError,
    DuplicateUsernameError,
)
from messenger.application.ports.activation_secrets import ActivationSecretService
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.domain.entities import ActivationToken, User


@dataclass(frozen=True, slots=True)
class CreateUserInvitationCommand:
    """Input for an administrator-created account invitation."""

    actor_user_id: UUID
    username: str
    display_name: str


@dataclass(frozen=True, slots=True)
class CreateUserInvitationResult:
    """Invitation data; activation_secret must be shown only once."""

    user_id: UUID
    username: str
    display_name: str
    activation_secret: str
    expires_at: datetime


class CreateUserInvitation:
    """Authorize an admin and persist one invited account."""

    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        secrets: ActivationSecretService,
        activation_ttl: timedelta,
    ) -> None:
        if activation_ttl <= timedelta(0):
            raise ValueError("activation_ttl must be positive")
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._secrets = secrets
        self._activation_ttl = activation_ttl

    async def execute(
        self,
        command: CreateUserInvitationCommand,
    ) -> CreateUserInvitationResult:
        """Create an inactive user and return the secret exactly once."""
        now = self._clock.now()
        user = User.invite(
            username=command.username,
            display_name=command.display_name,
            now=now,
        )
        generated_secret = self._secrets.generate()
        expires_at = now + self._activation_ttl
        activation_token = ActivationToken.create(
            user_id=user.id,
            token_hash=generated_secret.digest,
            created_at=now,
            expires_at=expires_at,
        )

        async with self._unit_of_work() as uow:
            actor = await uow.users.get_by_id(command.actor_user_id)
            if actor is None or not actor.is_active or not actor.is_admin:
                raise AuthorizationDeniedError("active administrator required")

            existing = await uow.users.get_by_username(user.username)
            if existing is not None:
                raise DuplicateUsernameError("username is already in use")

            await uow.users.add_invited(user)
            await uow.activation_tokens.add(activation_token)
            await uow.commit()

        return CreateUserInvitationResult(
            user_id=user.id,
            username=user.username,
            display_name=user.display_name,
            activation_secret=generated_secret.plaintext,
            expires_at=expires_at,
        )
