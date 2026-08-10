"""Idempotent opaque-session logout."""

from dataclasses import dataclass

from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService


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
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._credentials = credentials

    async def execute(self, command: LogoutCommand) -> None:
        token_hash = self._credentials.digest(command.session_credential)
        async with self._unit_of_work() as uow:
            matched = await uow.sessions.get_by_token_hash_for_update(token_hash)
            if matched is None or matched.session.revoked_at is not None:
                return
            await uow.sessions.update(matched.session.revoke(self._clock.now()))
            await uow.commit()
