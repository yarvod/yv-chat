"""Create one unique direct conversation."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import require_active_actor
from messenger.application.conversations.dto import (
    ConversationResult,
    build_conversation_result,
)
from messenger.application.errors import (
    ConversationParticipantNotFoundError,
    DuplicateDirectConversationError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import Conversation


@dataclass(frozen=True, slots=True)
class CreateDirectConversationCommand:
    actor_user_id: UUID
    other_user_id: UUID


class CreateDirectConversation:
    def __init__(
        self,
        *,
        unit_of_work: ConversationUnitOfWorkFactory,
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
        command: CreateDirectConversationCommand,
    ) -> ConversationResult:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            target = await unit_of_work.users.get_by_id(command.other_user_id)
            if target is None or not target.is_active:
                raise ConversationParticipantNotFoundError("participant not found")
            existing = await unit_of_work.conversations.get_direct_by_users(
                command.actor_user_id,
                command.other_user_id,
            )
            if existing is not None:
                raise DuplicateDirectConversationError("direct conversation already exists")
            now = self._clock.now()
            conversation = Conversation.create_direct(
                created_by=command.actor_user_id,
                other_user_id=command.other_user_id,
                now=now,
            )
            await unit_of_work.conversations.add(conversation)
            sync_events = events_for_users(
                {member.user_id for member in conversation.members},
                event_type=SyncEventType.CONVERSATION_UPDATED,
                conversation_id=conversation.id,
                message_id=None,
                now=now,
                policy=self._sync_policy,
            )
            await unit_of_work.sync_events.append(sync_events)
            result = await build_conversation_result(conversation, unit_of_work.users)
            await unit_of_work.commit()
        await publish_best_effort(self._realtime_notifier, notifications_from_sync(sync_events))
        return result
