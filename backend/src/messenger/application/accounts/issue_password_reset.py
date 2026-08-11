"""Administrator-issued password recovery with immediate session revocation."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.accounts.authorization import require_active_admin
from messenger.application.accounts.password_reset_policy import PasswordResetPolicy
from messenger.application.accounts.session_revocation import revoke_sessions
from messenger.application.errors import (
    AccountActivationRequiredError,
    ManagedUserNotFoundError,
    SelfPasswordResetError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.password_reset_secrets import PasswordResetSecretService
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.domain.entities import PasswordResetToken, SecurityEvent, SecurityEventType


@dataclass(frozen=True, slots=True)
class IssuePasswordResetCommand:
    actor_user_id: UUID
    actor_session_id: UUID
    target_user_id: UUID


@dataclass(frozen=True, slots=True)
class IssuePasswordResetResult:
    user_id: UUID
    reset_secret: str
    expires_at: datetime
    revoked_sessions: int


class IssuePasswordReset:
    """Replace outstanding reset credentials and terminate target devices."""

    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        secrets: PasswordResetSecretService,
        password_reset_policy: PasswordResetPolicy,
        event_policy: SecurityEventPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._secrets = secrets
        self._password_reset_policy = password_reset_policy
        self._event_policy = event_policy

    async def execute(self, command: IssuePasswordResetCommand) -> IssuePasswordResetResult:
        now = self._clock.now()
        generated = self._secrets.generate()
        expires_at = now + self._password_reset_policy.ttl

        async with self._unit_of_work() as unit_of_work:
            await require_active_admin(unit_of_work.users, command.actor_user_id)
            if command.actor_user_id == command.target_user_id:
                raise SelfPasswordResetError("administrator cannot reset self through admin API")
            target = await unit_of_work.users.get_managed_by_id(
                command.target_user_id,
                for_update=True,
            )
            if target is None:
                raise ManagedUserNotFoundError("managed user was not found")
            if not target.password_configured:
                raise AccountActivationRequiredError("account has not completed activation")

            old_tokens = (
                await unit_of_work.password_reset_tokens.list_unconsumed_for_user_for_update(
                    command.target_user_id
                )
            )
            for token in old_tokens:
                await unit_of_work.password_reset_tokens.update_lifecycle(token.revoke(now))

            records = await unit_of_work.sessions.list_for_user_for_update(command.target_user_id)
            revoked_sessions = await revoke_sessions(
                unit_of_work,
                records,
                now=now,
                keep_session_id=None,
            )
            await unit_of_work.password_reset_tokens.add(
                PasswordResetToken.create(
                    user_id=command.target_user_id,
                    token_hash=generated.digest,
                    created_at=now,
                    expires_at=expires_at,
                )
            )
            await unit_of_work.security_events.prune_expired(now)
            await unit_of_work.security_events.add(
                SecurityEvent.create(
                    user_id=command.target_user_id,
                    event_type=SecurityEventType.PASSWORD_RESET_ISSUED,
                    now=now,
                    retention=self._event_policy.retention,
                    actor_session_id=command.actor_session_id,
                )
            )
            await unit_of_work.commit()

        return IssuePasswordResetResult(
            user_id=command.target_user_id,
            reset_secret=generated.plaintext,
            expires_at=expires_at,
            revoked_sessions=revoked_sessions,
        )
