"""Message reaction repository port."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import MessageReaction


class MessageReactionRepository(Protocol):
    async def list_for_messages(
        self,
        *,
        conversation_id: UUID,
        message_ids: set[UUID],
    ) -> list[MessageReaction]: ...

    async def add(
        self,
        *,
        message_id: UUID,
        user_id: UUID,
        reaction: str,
        created_at: datetime,
    ) -> bool: ...

    async def remove(self, *, message_id: UUID, user_id: UUID, reaction: str) -> bool: ...
