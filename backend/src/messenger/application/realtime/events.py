"""Small routing hints that wake durable cursor sync."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from messenger.application.sync import PendingSyncEvent, SyncEventType


class RealtimeEventType(StrEnum):
    NEW_MESSAGE = "new_message"
    CONVERSATION_UPDATED = "conversation_updated"
    MESSAGE_DELETED = "message_deleted"
    MESSAGE_REACTION_UPDATED = "message_reaction_updated"
    READ_RECEIPT = "read_receipt"
    DELIVERY_RECEIPT = "delivery_receipt"
    TYPING = "typing"
    PRESENCE = "presence"


@dataclass(frozen=True, slots=True)
class RealtimeNotification:
    user_id: UUID
    event_id: UUID
    event_type: RealtimeEventType
    conversation_id: UUID
    message_id: UUID | None
    actor_user_id: UUID | None
    read_sequence: int | None
    typing_active: bool | None = None
    expires_at: datetime | None = None
    presence_online: bool | None = None
    delivery_sequence: int | None = None

    def __post_init__(self) -> None:
        if self.event_type is RealtimeEventType.TYPING:
            valid = (
                self.message_id is None
                and self.actor_user_id is not None
                and self.read_sequence is None
                and self.typing_active is not None
                and self.expires_at is not None
                and self.expires_at.tzinfo is not None
                and self.expires_at.utcoffset() is not None
                and self.presence_online is None
                and self.delivery_sequence is None
            )
        elif self.event_type is RealtimeEventType.PRESENCE:
            valid = (
                self.message_id is None
                and self.actor_user_id is not None
                and self.read_sequence is None
                and self.typing_active is None
                and self.expires_at is None
                and self.presence_online is not None
                and self.delivery_sequence is None
            )
        elif self.event_type is RealtimeEventType.MESSAGE_REACTION_UPDATED:
            valid = (
                self.message_id is not None
                and self.actor_user_id is not None
                and self.read_sequence is None
                and self.typing_active is None
                and self.expires_at is None
                and self.presence_online is None
                and self.delivery_sequence is None
            )
        elif self.event_type is RealtimeEventType.READ_RECEIPT:
            valid = (
                self.message_id is None
                and self.actor_user_id is not None
                and self.read_sequence is not None
                and self.read_sequence > 0
                and self.typing_active is None
                and self.expires_at is None
                and self.presence_online is None
                and self.delivery_sequence is None
            )
        elif self.event_type is RealtimeEventType.DELIVERY_RECEIPT:
            valid = (
                self.message_id is None
                and self.actor_user_id is not None
                and self.read_sequence is None
                and self.typing_active is None
                and self.expires_at is None
                and self.presence_online is None
                and self.delivery_sequence is not None
                and self.delivery_sequence > 0
            )
        elif self.event_type is RealtimeEventType.CONVERSATION_UPDATED:
            valid = (
                self.message_id is None
                and self.actor_user_id is None
                and self.read_sequence is None
                and self.typing_active is None
                and self.expires_at is None
                and self.presence_online is None
                and self.delivery_sequence is None
            )
        else:
            valid = (
                self.message_id is not None
                and self.actor_user_id is None
                and self.read_sequence is None
                and self.typing_active is None
                and self.expires_at is None
                and self.presence_online is None
                and self.delivery_sequence is None
            )
        if not valid:
            raise ValueError("realtime notification shape does not match event type")


_SYNC_EVENT_TYPES = {
    SyncEventType.MESSAGE_CREATED: RealtimeEventType.NEW_MESSAGE,
    SyncEventType.CONVERSATION_UPDATED: RealtimeEventType.CONVERSATION_UPDATED,
    SyncEventType.MESSAGE_DELETED: RealtimeEventType.MESSAGE_DELETED,
    SyncEventType.MESSAGE_REACTION_UPDATED: RealtimeEventType.MESSAGE_REACTION_UPDATED,
    SyncEventType.READ_RECEIPT: RealtimeEventType.READ_RECEIPT,
    SyncEventType.DELIVERY_RECEIPT: RealtimeEventType.DELIVERY_RECEIPT,
}


def notifications_from_sync(
    events: list[PendingSyncEvent],
) -> tuple[RealtimeNotification, ...]:
    return tuple(
        RealtimeNotification(
            user_id=event.user_id,
            event_id=event.event_id,
            event_type=_SYNC_EVENT_TYPES[event.event_type],
            conversation_id=event.conversation_id,
            message_id=event.message_id,
            actor_user_id=event.actor_user_id,
            read_sequence=event.read_sequence,
            delivery_sequence=event.delivery_sequence,
        )
        for event in events
    )
