"""Conversation read-state persistence port."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import ConversationReadState


@dataclass(frozen=True, slots=True)
class ConversationReadSummary:
    conversation_id: UUID
    last_read_sequence: int
    latest_sequence: int
    unread_count: int


class ConversationReadStateRepository(Protocol):
    async def get(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
    ) -> ConversationReadState | None: ...

    async def upsert(self, state: ConversationReadState) -> None: ...

    async def list_summaries(
        self,
        *,
        user_id: UUID,
        conversation_ids: set[UUID],
    ) -> list[ConversationReadSummary]: ...
