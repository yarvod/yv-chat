"""Create durable wake-up events after a user's active device roster changes."""

from datetime import datetime
from uuid import UUID

from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.application.sync.events import PendingSyncEvent


async def append_device_roster_events(
    unit_of_work: IdentityUnitOfWork,
    *,
    user_id: UUID,
    now: datetime,
    policy: SyncPolicy,
) -> list[PendingSyncEvent]:
    events: list[PendingSyncEvent] = []
    for conversation in await unit_of_work.conversations.list_active_for_user(user_id):
        events.extend(
            events_for_users(
                {member.user_id for member in conversation.members if member.is_active},
                event_type=SyncEventType.CONVERSATION_UPDATED,
                conversation_id=conversation.id,
                message_id=None,
                now=now,
                policy=policy,
            )
        )
    await unit_of_work.sync_events.append(events)
    return events
