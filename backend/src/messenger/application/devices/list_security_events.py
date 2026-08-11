"""List non-expired security events for the authenticated user."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.domain.entities import SecurityEventType


@dataclass(frozen=True, slots=True)
class ListSecurityEventsQuery:
    user_id: UUID
    limit: int = 50


@dataclass(frozen=True, slots=True)
class SecurityEventItem:
    id: UUID
    event_type: SecurityEventType
    created_at: datetime
    actor_session_id: UUID | None
    target_device_id: UUID | None


class ListSecurityEvents:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, query: ListSecurityEventsQuery) -> list[SecurityEventItem]:
        if not 1 <= query.limit <= 100:
            raise ValueError("security event limit must be between 1 and 100")
        async with self._unit_of_work() as uow:
            events = await uow.security_events.list_recent(
                user_id=query.user_id,
                now=self._clock.now(),
                limit=query.limit,
            )
        return [
            SecurityEventItem(
                id=event.id,
                event_type=event.event_type,
                created_at=event.created_at,
                actor_session_id=event.actor_session_id,
                target_device_id=event.target_device_id,
            )
            for event in events
        ]
