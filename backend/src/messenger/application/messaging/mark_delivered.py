"""Monotonically advance one device's conversation delivery cursor."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import AuthorizationDeniedError, InvalidDeliverySequenceError
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.sync import PendingSyncEvent, SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import ConversationDeliveryState


@dataclass(frozen=True, slots=True)
class MarkConversationDeliveredCommand:
    actor_user_id: UUID
    actor_device_id: UUID
    conversation_id: UUID
    sequence: int


@dataclass(frozen=True, slots=True)
class MarkConversationDeliveredResult:
    conversation_id: UUID
    last_delivered_sequence: int
    updated_at: datetime
    advanced: bool


class MarkConversationDelivered:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        clock: Clock,
        sync_policy: SyncPolicy,
        realtime_notifier: RealtimeNotifier,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._sync_policy = sync_policy
        self._realtime_notifier = realtime_notifier

    async def execute(
        self, command: MarkConversationDeliveredCommand
    ) -> MarkConversationDeliveredResult:
        if command.sequence <= 0:
            raise InvalidDeliverySequenceError("delivery sequence must be positive")
        sync_events: list[PendingSyncEvent] = []
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            device = await unit_of_work.devices.get_owned_by_id(
                user_id=command.actor_user_id,
                device_id=command.actor_device_id,
            )
            if device is None or device.revoked_at is not None:
                raise AuthorizationDeniedError("active owned device required")
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(
                    command.conversation_id, for_update=True
                ),
                command.actor_user_id,
            )
            if not await unit_of_work.messages.exists_at_sequence(
                conversation_id=conversation.id,
                sequence=command.sequence,
            ):
                raise InvalidDeliverySequenceError("delivery sequence does not exist")
            current = await unit_of_work.delivery_states.get(
                device_id=device.id,
                conversation_id=conversation.id,
            )
            if current is not None and command.sequence <= current.last_delivered_sequence:
                return MarkConversationDeliveredResult(
                    conversation.id,
                    current.last_delivered_sequence,
                    current.updated_at,
                    False,
                )
            now = self._clock.now()
            updated = (
                current.advance(command.sequence, now)
                if current is not None
                else ConversationDeliveryState.create(
                    device_id=device.id,
                    conversation_id=conversation.id,
                    sequence=command.sequence,
                    now=now,
                )
            )
            await unit_of_work.delivery_states.upsert(updated)
            sync_events = events_for_users(
                {member.user_id for member in conversation.members if member.is_active},
                event_type=SyncEventType.DELIVERY_RECEIPT,
                conversation_id=conversation.id,
                message_id=None,
                actor_user_id=command.actor_user_id,
                delivery_sequence=updated.last_delivered_sequence,
                now=now,
                policy=self._sync_policy,
            )
            await unit_of_work.sync_events.append(sync_events)
            await unit_of_work.commit()
        await publish_best_effort(self._realtime_notifier, notifications_from_sync(sync_events))
        return MarkConversationDeliveredResult(
            updated.conversation_id,
            updated.last_delivered_sequence,
            updated.updated_at,
            True,
        )
