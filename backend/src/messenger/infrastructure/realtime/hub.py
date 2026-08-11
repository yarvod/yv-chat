"""Bounded single-process connection registry."""

import asyncio
from dataclasses import dataclass, field
from uuid import UUID, uuid4

from messenger.application.errors import RealtimeSubscriptionClosedError
from messenger.application.ports.realtime import RealtimeSubscription
from messenger.application.realtime import RealtimeNotification


@dataclass(slots=True, eq=False)
class InMemoryRealtimeSubscription:
    id: UUID
    user_id: UUID
    session_id: UUID
    queue: asyncio.Queue[RealtimeNotification]
    closed: asyncio.Event = field(default_factory=asyncio.Event)

    async def receive(self) -> RealtimeNotification:
        receive_task = asyncio.create_task(self.queue.get())
        close_task = asyncio.create_task(self.closed.wait())
        tasks = {receive_task, close_task}
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if close_task in done:
                raise RealtimeSubscriptionClosedError
            return receive_task.result()
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    def close(self) -> None:
        self.closed.set()


class InMemoryRealtimeHub:
    """Fan out opaque hints with a hard per-connection memory bound."""

    def __init__(self, *, queue_size: int = 64) -> None:
        if not 1 <= queue_size <= 1_024:
            raise ValueError("realtime queue size is out of bounds")
        self._queue_size = queue_size
        self._subscriptions: dict[UUID, dict[UUID, InMemoryRealtimeSubscription]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(
        self,
        *,
        user_id: UUID,
        session_id: UUID,
    ) -> InMemoryRealtimeSubscription:
        subscription = InMemoryRealtimeSubscription(
            id=uuid4(),
            user_id=user_id,
            session_id=session_id,
            queue=asyncio.Queue(maxsize=self._queue_size),
        )
        async with self._lock:
            self._subscriptions.setdefault(user_id, {})[subscription.id] = subscription
        return subscription

    async def unsubscribe(self, subscription: RealtimeSubscription) -> None:
        async with self._lock:
            user_subscriptions = self._subscriptions.get(subscription.user_id)
            if user_subscriptions is not None:
                user_subscriptions.pop(subscription.id, None)
                if not user_subscriptions:
                    self._subscriptions.pop(subscription.user_id, None)
            subscription.close()

    async def publish(self, notifications: tuple[RealtimeNotification, ...]) -> None:
        slow: list[InMemoryRealtimeSubscription] = []
        async with self._lock:
            for notification in notifications:
                for subscription in tuple(
                    self._subscriptions.get(notification.user_id, {}).values()
                ):
                    try:
                        subscription.queue.put_nowait(notification)
                    except asyncio.QueueFull:
                        slow.append(subscription)
            for subscription in slow:
                user_subscriptions = self._subscriptions.get(subscription.user_id)
                if user_subscriptions is not None:
                    user_subscriptions.pop(subscription.id, None)
                    if not user_subscriptions:
                        self._subscriptions.pop(subscription.user_id, None)
                subscription.closed.set()

    async def active_count(self) -> int:
        async with self._lock:
            return sum(len(items) for items in self._subscriptions.values())
