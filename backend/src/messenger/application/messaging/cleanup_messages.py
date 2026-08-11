"""Bounded retry-safe ciphertext expiry and tombstone purge operation."""

from dataclasses import dataclass

from messenger.application.messaging.delete_message import deletion_events
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.sync import PendingSyncEvent, SyncPolicy
from messenger.domain.entities import MessageDeletionReason


@dataclass(frozen=True, slots=True)
class CleanupExpiredMessagesResult:
    expired_messages: int
    purged_tombstones: int


class CleanupExpiredMessages:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        clock: Clock,
        retention_policy: MessageRetentionPolicy,
        sync_policy: SyncPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._retention_policy = retention_policy
        self._sync_policy = sync_policy

    async def execute(self) -> CleanupExpiredMessagesResult:
        now = self._clock.now()
        sync_events: list[PendingSyncEvent] = []
        async with self._unit_of_work() as unit_of_work:
            purged = await unit_of_work.messages.purge_expired_tombstones(
                now=now,
                limit=self._retention_policy.cleanup_batch_size,
            )
            expired = await unit_of_work.messages.list_expired_active(
                now=now,
                limit=self._retention_policy.cleanup_batch_size,
            )
            conversations = {
                conversation.id: conversation
                for conversation in await unit_of_work.conversations.get_by_ids(
                    {message.conversation_id for message in expired}
                )
            }
            for message in expired:
                conversation = conversations.get(message.conversation_id)
                if conversation is None:
                    raise RuntimeError("message conversation disappeared during cleanup")
                tombstone = message.to_tombstone(
                    now=message.expires_at,
                    tombstone_retention=self._retention_policy.tombstone_retention,
                    reason=MessageDeletionReason.EXPIRED,
                    deleted_by_user_id=None,
                )
                await unit_of_work.messages.update(tombstone)
                sync_events.extend(
                    deletion_events(
                        tombstone,
                        {member.user_id for member in conversation.members if member.is_active},
                        now=now,
                        sync_policy=self._sync_policy,
                    )
                )
            if sync_events:
                await unit_of_work.sync_events.append(sync_events)
            if expired or purged:
                await unit_of_work.commit()
        return CleanupExpiredMessagesResult(len(expired), purged)
