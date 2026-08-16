"""Authorize and persist one delete-for-everyone tombstone."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import AuthorizationDeniedError, MessageNotFoundError
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.sync import PendingSyncEvent, SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import (
    ConversationMemberRole,
    ConversationType,
    Message,
    MessageDeletionReason,
)


@dataclass(frozen=True, slots=True)
class DeleteMessageForEveryoneCommand:
    actor_user_id: UUID
    conversation_id: UUID
    message_id: UUID


@dataclass(frozen=True, slots=True)
class DeleteMessageForEveryoneResult:
    message_id: UUID
    conversation_id: UUID
    sequence: int
    deletion_reason: MessageDeletionReason
    deleted_at: datetime
    advanced: bool


class DeleteMessageForEveryone:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        clock: Clock,
        retention_policy: MessageRetentionPolicy,
        sync_policy: SyncPolicy,
        realtime_notifier: RealtimeNotifier,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._retention_policy = retention_policy
        self._sync_policy = sync_policy
        self._realtime_notifier = realtime_notifier

    async def execute(
        self, command: DeleteMessageForEveryoneCommand
    ) -> DeleteMessageForEveryoneResult:
        sync_events: list[PendingSyncEvent] = []
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            conversation, membership = require_active_membership(
                await unit_of_work.conversations.get_by_id(
                    command.conversation_id, for_update=True
                ),
                command.actor_user_id,
            )
            message = await unit_of_work.messages.get_by_id(command.message_id, for_update=True)
            if message is None or message.conversation_id != conversation.id:
                raise MessageNotFoundError("message not found in conversation")
            may_moderate = (
                conversation.conversation_type is ConversationType.GROUP
                and membership.role in {ConversationMemberRole.OWNER, ConversationMemberRole.ADMIN}
            )
            if message.sender_user_id != command.actor_user_id and not may_moderate:
                raise AuthorizationDeniedError("message deletion is not allowed")
            if message.is_deleted:
                return result_from(message, advanced=False)
            now = self._clock.now()
            tombstone = message.to_tombstone(
                now=now,
                tombstone_retention=self._retention_policy.tombstone_retention,
                reason=MessageDeletionReason.MANUAL,
                deleted_by_user_id=command.actor_user_id,
            )
            await unit_of_work.messages.update(tombstone)
            await unit_of_work.pins.remove(
                conversation_id=conversation.id,
                message_id=message.id,
            )
            sync_events = deletion_events(
                tombstone,
                {member.user_id for member in conversation.members if member.is_active},
                now=now,
                sync_policy=self._sync_policy,
            )
            await unit_of_work.sync_events.append(sync_events)
            await unit_of_work.commit()
        await publish_best_effort(self._realtime_notifier, notifications_from_sync(sync_events))
        return result_from(tombstone, advanced=True)


def deletion_events(
    message: Message,
    recipients: set[UUID],
    *,
    now: datetime,
    sync_policy: SyncPolicy,
) -> list[PendingSyncEvent]:
    return events_for_users(
        recipients,
        event_type=SyncEventType.MESSAGE_DELETED,
        conversation_id=message.conversation_id,
        message_id=message.id,
        now=now,
        policy=sync_policy,
    )


def result_from(message: Message, *, advanced: bool) -> DeleteMessageForEveryoneResult:
    if message.deletion_reason is None or message.deleted_at is None:
        raise RuntimeError("delete result requires a tombstone")
    return DeleteMessageForEveryoneResult(
        message_id=message.id,
        conversation_id=message.conversation_id,
        sequence=message.sequence,
        deletion_reason=message.deletion_reason,
        deleted_at=message.deleted_at,
        advanced=advanced,
    )
