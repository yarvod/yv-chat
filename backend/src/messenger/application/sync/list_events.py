"""Retention-aware offline catch-up query."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import require_active_actor
from messenger.application.errors import InvalidMessageEnvelopeError
from messenger.application.ports.clock import Clock
from messenger.application.ports.sync import SyncUnitOfWorkFactory
from messenger.application.sync.events import SyncEvent
from messenger.application.sync.policy import SyncPolicy


@dataclass(frozen=True, slots=True)
class ListSyncEventsQuery:
    actor_user_id: UUID
    after_cursor: int
    limit: int


@dataclass(frozen=True, slots=True)
class ListSyncEventsResult:
    events: tuple[SyncEvent, ...]
    next_cursor: int
    stream_cursor: int
    has_more: bool
    reset_required: bool


class ListSyncEvents:
    def __init__(
        self,
        *,
        unit_of_work: SyncUnitOfWorkFactory,
        clock: Clock,
        sync_policy: SyncPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = sync_policy

    async def execute(self, query: ListSyncEventsQuery) -> ListSyncEventsResult:
        if query.after_cursor < 0 or not 1 <= query.limit <= self._policy.max_page_size:
            raise InvalidMessageEnvelopeError("invalid sync page bounds")
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            await unit_of_work.sync_events.prune_expired(self._clock.now())
            page = await unit_of_work.sync_events.list_after(
                user_id=query.actor_user_id,
                after_cursor=query.after_cursor,
                limit=query.limit,
            )
            await unit_of_work.commit()
        next_cursor = page.events[-1].cursor if page.events else query.after_cursor
        reset_required = page.stream_cursor > query.after_cursor and (
            page.oldest_cursor is None or query.after_cursor < page.oldest_cursor - 1
        )
        return ListSyncEventsResult(
            events=page.events,
            next_cursor=next_cursor,
            stream_cursor=page.stream_cursor,
            has_more=next_cursor < page.stream_cursor,
            reset_required=reset_required,
        )
