"""Security-event repository port."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import SecurityEvent


class SecurityEventRepository(Protocol):
    async def add(self, event: SecurityEvent) -> None: ...

    async def list_recent(
        self,
        *,
        user_id: UUID,
        now: datetime,
        limit: int,
    ) -> list[SecurityEvent]: ...

    async def prune_expired(self, now: datetime) -> None: ...
