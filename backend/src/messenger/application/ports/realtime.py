"""Process-local realtime notification boundary."""

from typing import Protocol
from uuid import UUID

from messenger.application.realtime.events import RealtimeNotification


class RealtimeSubscription(Protocol):
    """One bounded authenticated connection inbox."""

    id: UUID
    user_id: UUID
    session_id: UUID

    async def receive(self) -> RealtimeNotification: ...

    def close(self) -> None: ...


class RealtimeNotifier(Protocol):
    """Best-effort post-commit notification publisher."""

    async def publish(self, notifications: tuple[RealtimeNotification, ...]) -> None: ...


class RealtimeHub(RealtimeNotifier, Protocol):
    """Registry used by the WebSocket transport without exposing WebSocket types."""

    async def subscribe(
        self,
        *,
        user_id: UUID,
        session_id: UUID,
    ) -> RealtimeSubscription: ...

    async def unsubscribe(self, subscription: RealtimeSubscription) -> None: ...
