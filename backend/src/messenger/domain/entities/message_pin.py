"""Bounded opaque reference to a pinned conversation message."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.domain.entities._validation import require_aware_datetime


@dataclass(frozen=True, slots=True)
class MessagePin:
    conversation_id: UUID
    message_id: UUID
    pinned_by_user_id: UUID
    pinned_at: datetime

    def __post_init__(self) -> None:
        require_aware_datetime(self.pinned_at, "pinned_at")
