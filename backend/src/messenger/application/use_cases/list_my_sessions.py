"""List active device-bound sessions for the authenticated user."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ListMySessionsQuery:
    user_id: UUID
    current_session_id: UUID


@dataclass(frozen=True, slots=True)
class MySessionItem:
    session_id: UUID
    device_id: UUID
    device_name: str
    is_current: bool
    created_at: datetime
    last_seen_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    login_ip: str | None
    last_ip: str | None


class ListMySessions:
    """Return only active sessions owned by the authenticated user."""

    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, query: ListMySessionsQuery) -> list[MySessionItem]:
        async with self._unit_of_work() as uow:
            records = await uow.sessions.list_active_with_devices(
                user_id=query.user_id,
                now=self._clock.now(),
            )

        items = [
            MySessionItem(
                session_id=record.session.id,
                device_id=record.device.id,
                device_name=record.device.name,
                is_current=record.session.id == query.current_session_id,
                created_at=record.session.created_at,
                last_seen_at=record.session.last_seen_at,
                idle_expires_at=record.session.idle_expires_at,
                absolute_expires_at=record.session.absolute_expires_at,
                login_ip=record.device.login_ip,
                last_ip=record.device.last_ip,
            )
            for record in records
        ]
        return sorted(items, key=lambda item: not item.is_current)
