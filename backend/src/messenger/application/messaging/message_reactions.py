"""Authorize, aggregate and mutate bounded message reactions."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import MessageNotFoundError
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import ALLOWED_MESSAGE_REACTIONS, MessageReaction


@dataclass(frozen=True, slots=True)
class MessageReactionSummary:
    message_id: UUID
    reaction: str
    count: int
    reacted_by_actor: bool


@dataclass(frozen=True, slots=True)
class ListMessageReactionsQuery:
    actor_user_id: UUID
    conversation_id: UUID
    message_ids: tuple[UUID, ...]


@dataclass(frozen=True, slots=True)
class SetMessageReactionCommand:
    actor_user_id: UUID
    conversation_id: UUID
    message_id: UUID
    reaction: str
    active: bool


def aggregate_reactions(
    reactions: list[MessageReaction],
    actor_user_id: UUID,
) -> list[MessageReactionSummary]:
    counts: dict[tuple[UUID, str], tuple[int, bool]] = {}
    for item in reactions:
        key = (item.message_id, item.reaction)
        count, mine = counts.get(key, (0, False))
        counts[key] = (count + 1, mine or item.user_id == actor_user_id)
    reaction_order = {reaction: index for index, reaction in enumerate(ALLOWED_MESSAGE_REACTIONS)}
    return [
        MessageReactionSummary(message_id, reaction, count, mine)
        for (message_id, reaction), (count, mine) in sorted(
            counts.items(),
            key=lambda item: (item[0][0].int, reaction_order[item[0][1]]),
        )
    ]


class ListMessageReactions:
    def __init__(self, *, unit_of_work: MessagingUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: ListMessageReactionsQuery) -> list[MessageReactionSummary]:
        if not 1 <= len(query.message_ids) <= 100 or len(set(query.message_ids)) != len(
            query.message_ids
        ):
            raise ValueError("reaction message selection is out of range")
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            require_active_membership(
                await unit_of_work.conversations.get_by_id(query.conversation_id),
                query.actor_user_id,
            )
            reactions = await unit_of_work.reactions.list_for_messages(
                conversation_id=query.conversation_id,
                message_ids=set(query.message_ids),
            )
            return aggregate_reactions(reactions, query.actor_user_id)


class SetMessageReaction:
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

    async def execute(self, command: SetMessageReactionCommand) -> list[MessageReactionSummary]:
        if command.reaction not in ALLOWED_MESSAGE_REACTIONS:
            raise ValueError("unsupported message reaction")
        sync_events = []
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(command.conversation_id),
                command.actor_user_id,
            )
            message = await unit_of_work.messages.get_by_id(command.message_id)
            if (
                message is None
                or message.conversation_id != conversation.id
                or message.deleted_at is not None
            ):
                raise MessageNotFoundError("message not found")
            now = self._clock.now()
            changed = (
                await unit_of_work.reactions.add(
                    message_id=message.id,
                    user_id=command.actor_user_id,
                    reaction=command.reaction,
                    created_at=now,
                )
                if command.active
                else await unit_of_work.reactions.remove(
                    message_id=message.id,
                    user_id=command.actor_user_id,
                    reaction=command.reaction,
                )
            )
            if changed:
                recipients = {member.user_id for member in conversation.members if member.is_active}
                sync_events = events_for_users(
                    recipients,
                    event_type=SyncEventType.MESSAGE_REACTION_UPDATED,
                    conversation_id=conversation.id,
                    message_id=message.id,
                    actor_user_id=command.actor_user_id,
                    now=now,
                    policy=self._sync_policy,
                )
                await unit_of_work.sync_events.append(sync_events)
            reactions = await unit_of_work.reactions.list_for_messages(
                conversation_id=conversation.id,
                message_ids={message.id},
            )
            await unit_of_work.commit()
        if sync_events:
            await publish_best_effort(
                self._realtime_notifier,
                notifications_from_sync(sync_events),
            )
        return aggregate_reactions(reactions, command.actor_user_id)
