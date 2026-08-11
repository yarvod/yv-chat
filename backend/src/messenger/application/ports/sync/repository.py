"""Per-user cursor stream repository."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from messenger.application.sync.events import PendingSyncEvent, SyncStreamPage


class SyncRepository(Protocol):
    async def append(self, events: list[PendingSyncEvent]) -> None: ...

    async def list_after(
        self,
        *,
        user_id: UUID,
        after_cursor: int,
        limit: int,
    ) -> SyncStreamPage: ...

    async def prune_expired(self, now: datetime) -> None: ...
