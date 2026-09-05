"""Per-device delivery-state persistence port."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import ConversationDeliveryState


@dataclass(frozen=True, slots=True)
class ParticipantDeliverySummary:
    conversation_id: UUID
    user_id: UUID
    delivered_sequence: int
    read_sequence: int = 0


class ConversationDeliveryStateRepository(Protocol):
    async def get(
        self, *, device_id: UUID, conversation_id: UUID
    ) -> ConversationDeliveryState | None: ...

    async def upsert(self, state: ConversationDeliveryState) -> None: ...

    async def list_participant_summaries(
        self, *, conversation_ids: set[UUID]
    ) -> list[ParticipantDeliverySummary]: ...
