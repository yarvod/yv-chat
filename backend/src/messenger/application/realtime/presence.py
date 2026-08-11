"""Authorized process-local presence snapshot and transitions."""

from dataclasses import dataclass
from uuid import UUID, uuid4

from messenger.application.conversations.authorization import require_active_actor
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeHub, RealtimeNotifier
from messenger.application.realtime.events import RealtimeEventType, RealtimeNotification
from messenger.application.realtime.publish import publish_best_effort


@dataclass(frozen=True, slots=True)
class PresenceRecord:
    conversation_id: UUID
    user_id: UUID


@dataclass(frozen=True, slots=True)
class ListPresenceSnapshotQuery:
    actor_user_id: UUID


class ListPresenceSnapshot:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        realtime_hub: RealtimeHub,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._realtime_hub = realtime_hub

    async def execute(self, query: ListPresenceSnapshotQuery) -> tuple[PresenceRecord, ...]:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversations = await unit_of_work.conversations.list_active_for_user(
                query.actor_user_id
            )
        candidates = {
            member.user_id
            for conversation in conversations
            for member in conversation.members
            if member.is_active and member.user_id != query.actor_user_id
        }
        online = await self._realtime_hub.online_user_ids(candidates)
        return tuple(
            PresenceRecord(conversation.id, member.user_id)
            for conversation in conversations
            for member in conversation.members
            if member.is_active and member.user_id in online
        )


@dataclass(frozen=True, slots=True)
class PublishPresenceCommand:
    actor_user_id: UUID
    online: bool


class PublishPresence:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        realtime_notifier: RealtimeNotifier,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._realtime_notifier = realtime_notifier

    async def execute(self, command: PublishPresenceCommand) -> None:
        async with self._unit_of_work() as unit_of_work:
            actor = await unit_of_work.users.get_by_id(command.actor_user_id)
            if actor is None:
                return
            if command.online:
                await require_active_actor(unit_of_work.users, command.actor_user_id)
            conversations = await unit_of_work.conversations.list_active_for_user(
                command.actor_user_id
            )
        notifications = tuple(
            RealtimeNotification(
                user_id=member.user_id,
                event_id=uuid4(),
                event_type=RealtimeEventType.PRESENCE,
                conversation_id=conversation.id,
                message_id=None,
                actor_user_id=command.actor_user_id,
                read_sequence=None,
                presence_online=command.online,
            )
            for conversation in conversations
            for member in conversation.members
            if member.is_active and member.user_id != command.actor_user_id
        )
        await publish_best_effort(self._realtime_notifier, notifications)
