"""Monotonic per-device delivery cursor for one conversation."""

from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class ConversationDeliveryState:
    device_id: UUID
    conversation_id: UUID
    last_delivered_sequence: int
    updated_at: datetime

    def __post_init__(self) -> None:
        if self.last_delivered_sequence <= 0:
            raise DomainValidationError("last_delivered_sequence must be positive")
        require_aware_datetime(self.updated_at, "updated_at")

    @classmethod
    def create(
        cls, *, device_id: UUID, conversation_id: UUID, sequence: int, now: datetime
    ) -> "ConversationDeliveryState":
        return cls(device_id, conversation_id, sequence, require_aware_datetime(now, "now"))

    def advance(self, sequence: int, now: datetime) -> "ConversationDeliveryState":
        if sequence <= self.last_delivered_sequence:
            return self
        return replace(
            self,
            last_delivered_sequence=sequence,
            updated_at=require_aware_datetime(now, "now"),
        )
