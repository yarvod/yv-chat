"""Typed opaque routing events for offline catch-up."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4


class SyncEventType(StrEnum):
    CONVERSATION_UPDATED = "conversation_updated"
    MESSAGE_CREATED = "message_created"
    MESSAGE_DELETED = "message_deleted"


@dataclass(frozen=True, slots=True)
class PendingSyncEvent:
    event_id: UUID
    user_id: UUID
    event_type: SyncEventType
    conversation_id: UUID
    message_id: UUID | None
    created_at: datetime
    expires_at: datetime

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        event_type: SyncEventType,
        conversation_id: UUID,
        message_id: UUID | None,
        created_at: datetime,
        expires_at: datetime,
    ) -> "PendingSyncEvent":
        return cls(
            event_id=uuid4(),
            user_id=user_id,
            event_type=event_type,
            conversation_id=conversation_id,
            message_id=message_id,
            created_at=created_at,
            expires_at=expires_at,
        )


@dataclass(frozen=True, slots=True)
class SyncEvent:
    event_id: UUID
    user_id: UUID
    cursor: int
    event_type: SyncEventType
    conversation_id: UUID
    message_id: UUID | None
    created_at: datetime
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class SyncStreamPage:
    events: tuple[SyncEvent, ...]
    stream_cursor: int
    oldest_cursor: int | None
