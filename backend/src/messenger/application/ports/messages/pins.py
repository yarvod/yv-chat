"""Message pin repository port."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import MessagePin


class MessagePinRepository(Protocol):
    async def list_active(
        self,
        *,
        conversation_id: UUID,
        now: datetime,
    ) -> list[tuple[MessagePin, int]]: ...

    async def exists(self, *, conversation_id: UUID, message_id: UUID) -> bool: ...

    async def count_active(self, *, conversation_id: UUID, now: datetime) -> int: ...

    async def add(self, pin: MessagePin) -> bool: ...

    async def remove(self, *, conversation_id: UUID, message_id: UUID) -> bool: ...
