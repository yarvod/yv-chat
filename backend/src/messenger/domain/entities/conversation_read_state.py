"""Monotonic user-level read cursor for one conversation."""

from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class ConversationReadState:
    user_id: UUID
    conversation_id: UUID
    last_read_sequence: int
    updated_at: datetime

    def __post_init__(self) -> None:
        if self.last_read_sequence <= 0:
            raise DomainValidationError("last_read_sequence must be positive")
        require_aware_datetime(self.updated_at, "updated_at")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        conversation_id: UUID,
        sequence: int,
        now: datetime,
    ) -> "ConversationReadState":
        return cls(
            user_id=user_id,
            conversation_id=conversation_id,
            last_read_sequence=sequence,
            updated_at=require_aware_datetime(now, "now"),
        )

    def advance(self, sequence: int, now: datetime) -> "ConversationReadState":
        if sequence <= self.last_read_sequence:
            return self
        return replace(
            self,
            last_read_sequence=sequence,
            updated_at=require_aware_datetime(now, "now"),
        )
