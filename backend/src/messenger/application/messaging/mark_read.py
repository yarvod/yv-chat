"""Monotonically advance one user's shared conversation read cursor."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import InvalidReadSequenceError
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.sync import PendingSyncEvent, SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import ConversationReadState


@dataclass(frozen=True, slots=True)
class MarkConversationReadCommand:
    actor_user_id: UUID
    conversation_id: UUID
    sequence: int


@dataclass(frozen=True, slots=True)
class MarkConversationReadResult:
    conversation_id: UUID
    last_read_sequence: int
    updated_at: datetime
    advanced: bool


class MarkConversationRead:
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
        self,
        command: MarkConversationReadCommand,
    ) -> MarkConversationReadResult:
        if command.sequence <= 0:
            raise InvalidReadSequenceError("read sequence must be positive")
        sync_events: list[PendingSyncEvent] = []
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(
                    command.conversation_id,
                    for_update=True,
                ),
                command.actor_user_id,
            )
            if not await unit_of_work.messages.exists_at_sequence(
                conversation_id=conversation.id,
                sequence=command.sequence,
            ):
                raise InvalidReadSequenceError("read sequence does not exist")
            current = await unit_of_work.read_states.get(
                user_id=command.actor_user_id,
                conversation_id=conversation.id,
            )
            if current is not None and command.sequence <= current.last_read_sequence:
                return MarkConversationReadResult(
                    conversation_id=conversation.id,
                    last_read_sequence=current.last_read_sequence,
                    updated_at=current.updated_at,
                    advanced=False,
                )
            now = self._clock.now()
            updated = (
                current.advance(command.sequence, now)
                if current is not None
                else ConversationReadState.create(
                    user_id=command.actor_user_id,
                    conversation_id=conversation.id,
                    sequence=command.sequence,
                    now=now,
                )
            )
            await unit_of_work.read_states.upsert(updated)
            sync_events = events_for_users(
                {member.user_id for member in conversation.members if member.is_active},
                event_type=SyncEventType.READ_RECEIPT,
                conversation_id=conversation.id,
                message_id=None,
                actor_user_id=command.actor_user_id,
                read_sequence=updated.last_read_sequence,
                now=now,
                policy=self._sync_policy,
            )
            await unit_of_work.sync_events.append(sync_events)
            await unit_of_work.commit()
        await publish_best_effort(
            self._realtime_notifier,
            notifications_from_sync(sync_events),
        )
        return MarkConversationReadResult(
            conversation_id=updated.conversation_id,
            last_read_sequence=updated.last_read_sequence,
            updated_at=updated.updated_at,
            advanced=True,
        )
