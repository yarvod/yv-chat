"""Passively revalidate an already authenticated realtime connection."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.errors import SessionNotAuthenticatedError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ValidateActiveSessionQuery:
    user_id: UUID
    session_id: UUID
    device_id: UUID


class ValidateActiveSession:
    """Check revocation/expiry without touching or rotating session state."""

    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, query: ValidateActiveSessionQuery) -> None:
        now = self._clock.now()
        async with self._unit_of_work() as unit_of_work:
            session = await unit_of_work.sessions.get_by_id(query.session_id)
            user = await unit_of_work.users.get_by_id(query.user_id)
            device = await unit_of_work.devices.get_owned_by_id(
                user_id=query.user_id,
                device_id=query.device_id,
            )
        if (
            session is None
            or session.user_id != query.user_id
            or session.device_id != query.device_id
            or session.revoked_at is not None
            or session.is_expired(now)
            or user is None
            or not user.is_active
            or device is None
            or device.revoked_at is not None
        ):
            raise SessionNotAuthenticatedError("session is not authenticated")
