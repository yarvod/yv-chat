"""Idempotent opaque-session logout."""

from dataclasses import dataclass

from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.domain.entities import SecurityEvent, SecurityEventType


@dataclass(frozen=True, slots=True)
class LogoutCommand:
    """Credential for the session that should be revoked."""

    session_credential: str


class Logout:
    """Revoke a known current/previous credential without revealing lookup state."""

    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        credentials: SessionCredentialService,
        event_policy: SecurityEventPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._credentials = credentials
        self._event_policy = event_policy

    async def execute(self, command: LogoutCommand) -> None:
        token_hash = self._credentials.digest(command.session_credential)
        async with self._unit_of_work() as uow:
            matched = await uow.sessions.get_by_token_hash_for_update(token_hash)
            if matched is None or matched.session.revoked_at is not None:
                return
            now = self._clock.now()
            await uow.sessions.update(matched.session.revoke(now))
            device = await uow.devices.get_by_id(
                matched.session.device_id,
                for_update=True,
            )
            if device is not None and device.revoked_at is None:
                await uow.devices.update(device.revoke(now))
            await uow.security_events.prune_expired(now)
            await uow.security_events.add(
                SecurityEvent.create(
                    user_id=matched.session.user_id,
                    event_type=SecurityEventType.LOGOUT,
                    now=now,
                    retention=self._event_policy.retention,
                    actor_session_id=matched.session.id,
                    target_device_id=matched.session.device_id,
                )
            )
            await uow.commit()
