"""Consume a purpose-bound credential and set a new account password."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.accounts.session_revocation import revoke_sessions
from messenger.application.errors import InvalidPasswordResetSecretError
from messenger.application.password_policy import validate_new_password
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.password_reset_secrets import PasswordResetSecretService
from messenger.application.ports.passwords import PasswordHasher
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.domain.entities import SecurityEvent, SecurityEventType


@dataclass(frozen=True, slots=True)
class ResetPasswordWithTokenCommand:
    reset_secret: str
    new_password: str


@dataclass(frozen=True, slots=True)
class ResetPasswordWithTokenResult:
    user_id: UUID
    reset_at: datetime
    revoked_sessions: int


class ResetPasswordWithToken:
    """Atomically consume one reset token, rotate password and revoke sessions."""

    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        secrets: PasswordResetSecretService,
        passwords: PasswordHasher,
        event_policy: SecurityEventPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._secrets = secrets
        self._passwords = passwords
        self._event_policy = event_policy

    async def execute(
        self,
        command: ResetPasswordWithTokenCommand,
    ) -> ResetPasswordWithTokenResult:
        validate_new_password(command.new_password)
        token_hash = self._secrets.digest(command.reset_secret)
        now = self._clock.now()

        async with self._unit_of_work() as unit_of_work:
            token = await unit_of_work.password_reset_tokens.get_by_hash_for_update(token_hash)
            if (
                token is None
                or token.revoked_at is not None
                or token.used_at is not None
                or token.is_expired(now)
            ):
                raise InvalidPasswordResetSecretError("password reset failed")
            authentication = await unit_of_work.users.get_authentication_by_id(
                token.user_id,
                for_update=True,
            )
            if authentication is None or authentication.password_hash is None:
                raise InvalidPasswordResetSecretError("password reset failed")

            password_hash = await self._passwords.hash(command.new_password)
            records = await unit_of_work.sessions.list_for_user_for_update(token.user_id)
            revoked_sessions = await revoke_sessions(
                unit_of_work,
                records,
                now=now,
                keep_session_id=None,
            )
            await unit_of_work.users.update_password(
                authentication.user.credentials_reset(now),
                password_hash,
            )
            await unit_of_work.password_reset_tokens.update_lifecycle(token.mark_used(now))
            await unit_of_work.security_events.prune_expired(now)
            await unit_of_work.security_events.add(
                SecurityEvent.create(
                    user_id=token.user_id,
                    event_type=SecurityEventType.PASSWORD_RESET_COMPLETED,
                    now=now,
                    retention=self._event_policy.retention,
                )
            )
            await unit_of_work.commit()

        return ResetPasswordWithTokenResult(
            user_id=token.user_id,
            reset_at=now,
            revoked_sessions=revoked_sessions,
        )
