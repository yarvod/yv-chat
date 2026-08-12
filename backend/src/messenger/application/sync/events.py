"""Typed opaque routing events for offline catch-up."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4


class SyncEventType(StrEnum):
    CONVERSATION_UPDATED = "conversation_updated"
    MESSAGE_CREATED = "message_created"
    MESSAGE_DELETED = "message_deleted"
    MESSAGE_REACTION_UPDATED = "message_reaction_updated"
    READ_RECEIPT = "read_receipt"
    DELIVERY_RECEIPT = "delivery_receipt"


def _validate_shape(
    event_type: SyncEventType,
    message_id: UUID | None,
    actor_user_id: UUID | None,
    read_sequence: int | None,
    delivery_sequence: int | None,
) -> None:
    if event_type is SyncEventType.CONVERSATION_UPDATED:
        valid = (
            message_id is None
            and actor_user_id is None
            and read_sequence is None
            and delivery_sequence is None
        )
    elif event_type in {SyncEventType.MESSAGE_CREATED, SyncEventType.MESSAGE_DELETED}:
        valid = (
            message_id is not None
            and actor_user_id is None
            and read_sequence is None
            and delivery_sequence is None
        )
    elif event_type is SyncEventType.MESSAGE_REACTION_UPDATED:
        valid = (
            message_id is not None
            and actor_user_id is not None
            and read_sequence is None
            and delivery_sequence is None
        )
    elif event_type is SyncEventType.READ_RECEIPT:
        valid = (
            message_id is None
            and actor_user_id is not None
            and read_sequence is not None
            and read_sequence > 0
            and delivery_sequence is None
        )
    else:
        valid = (
            message_id is None
            and actor_user_id is not None
            and read_sequence is None
            and delivery_sequence is not None
            and delivery_sequence > 0
        )
    if not valid:
        raise ValueError("sync event shape does not match event type")


@dataclass(frozen=True, slots=True)
class PendingSyncEvent:
    event_id: UUID
    user_id: UUID
    event_type: SyncEventType
    conversation_id: UUID
    message_id: UUID | None
    actor_user_id: UUID | None
    read_sequence: int | None
    delivery_sequence: int | None
    created_at: datetime
    expires_at: datetime

    def __post_init__(self) -> None:
        _validate_shape(
            self.event_type,
            self.message_id,
            self.actor_user_id,
            self.read_sequence,
            self.delivery_sequence,
        )

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        event_type: SyncEventType,
        conversation_id: UUID,
        message_id: UUID | None,
        actor_user_id: UUID | None = None,
        read_sequence: int | None = None,
        delivery_sequence: int | None = None,
        created_at: datetime,
        expires_at: datetime,
    ) -> "PendingSyncEvent":
        return cls(
            event_id=uuid4(),
            user_id=user_id,
            event_type=event_type,
            conversation_id=conversation_id,
            message_id=message_id,
            actor_user_id=actor_user_id,
            read_sequence=read_sequence,
            delivery_sequence=delivery_sequence,
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
    actor_user_id: UUID | None
    read_sequence: int | None
    delivery_sequence: int | None
    created_at: datetime
    expires_at: datetime

    def __post_init__(self) -> None:
        _validate_shape(
            self.event_type,
            self.message_id,
            self.actor_user_id,
            self.read_sequence,
            self.delivery_sequence,
        )


@dataclass(frozen=True, slots=True)
class SyncStreamPage:
    events: tuple[SyncEvent, ...]
    stream_cursor: int
    oldest_cursor: int | None
