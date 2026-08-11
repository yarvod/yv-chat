"""Explicit step-up revocation of every current-account session."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.accounts.session_revocation import (
    require_current_session,
    revoke_sessions,
)
from messenger.application.errors import InvalidStepUpCredentialsError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.passwords import PasswordHasher
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.domain.entities import SecurityEvent, SecurityEventType


@dataclass(frozen=True, slots=True)
class SecurityResetCommand:
    user_id: UUID
    current_session_id: UUID
    current_password: str


@dataclass(frozen=True, slots=True)
class SecurityResetResult:
    revoked_sessions: int


class SecurityReset:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        passwords: PasswordHasher,
        event_policy: SecurityEventPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._passwords = passwords
        self._event_policy = event_policy

    async def execute(self, command: SecurityResetCommand) -> SecurityResetResult:
        now = self._clock.now()
        async with self._unit_of_work() as unit_of_work:
            authentication = await unit_of_work.users.get_authentication_by_id(
                command.user_id,
                for_update=True,
            )
            if (
                authentication is None
                or not authentication.user.is_active
                or not await self._passwords.verify(
                    authentication.password_hash,
                    command.current_password,
                )
            ):
                raise InvalidStepUpCredentialsError("current password is invalid")

            records = await unit_of_work.sessions.list_for_user_for_update(command.user_id)
            require_current_session(
                records,
                current_session_id=command.current_session_id,
                now=now,
            )
            await unit_of_work.security_events.prune_expired(now)
            await unit_of_work.security_events.add(
                SecurityEvent.create(
                    user_id=command.user_id,
                    event_type=SecurityEventType.SECURITY_RESET,
                    now=now,
                    retention=self._event_policy.retention,
                    actor_session_id=command.current_session_id,
                )
            )
            revoked_count = await revoke_sessions(
                unit_of_work,
                records,
                now=now,
                keep_session_id=None,
            )
            await unit_of_work.commit()
        return SecurityResetResult(revoked_sessions=revoked_count)
