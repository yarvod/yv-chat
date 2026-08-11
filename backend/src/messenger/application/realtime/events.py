"""Small routing hints that wake durable cursor sync."""

from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from messenger.application.sync import PendingSyncEvent, SyncEventType


class RealtimeEventType(StrEnum):
    NEW_MESSAGE = "new_message"
    CONVERSATION_UPDATED = "conversation_updated"
    MESSAGE_DELETED = "message_deleted"


@dataclass(frozen=True, slots=True)
class RealtimeNotification:
    user_id: UUID
    event_id: UUID
    event_type: RealtimeEventType
    conversation_id: UUID
    message_id: UUID | None


_SYNC_EVENT_TYPES = {
    SyncEventType.MESSAGE_CREATED: RealtimeEventType.NEW_MESSAGE,
    SyncEventType.CONVERSATION_UPDATED: RealtimeEventType.CONVERSATION_UPDATED,
    SyncEventType.MESSAGE_DELETED: RealtimeEventType.MESSAGE_DELETED,
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
        )
        for event in events
    )
