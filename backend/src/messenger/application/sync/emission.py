"""Create bounded recipient-specific routing events."""

from datetime import datetime
from uuid import UUID

from messenger.application.sync.events import PendingSyncEvent, SyncEventType
from messenger.application.sync.policy import SyncPolicy


def events_for_users(
    user_ids: set[UUID],
    *,
    event_type: SyncEventType,
    conversation_id: UUID,
    message_id: UUID | None,
    actor_user_id: UUID | None = None,
    read_sequence: int | None = None,
    now: datetime,
    policy: SyncPolicy,
) -> list[PendingSyncEvent]:
    return [
        PendingSyncEvent.create(
            user_id=user_id,
            event_type=event_type,
            conversation_id=conversation_id,
            message_id=message_id,
            actor_user_id=actor_user_id,
            read_sequence=read_sequence,
            created_at=now,
            expires_at=now + policy.retention,
        )
        for user_id in sorted(user_ids, key=lambda value: value.int)
    ]
