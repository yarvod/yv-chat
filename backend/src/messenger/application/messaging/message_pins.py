"""Authorize, list and mutate bounded message pins."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import (
    AuthorizationDeniedError,
    MessageNotFoundError,
    MessagePinLimitError,
)
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
    MessagePin,
)

MAX_MESSAGE_PINS_PER_CONVERSATION = 50


@dataclass(frozen=True, slots=True)
class MessagePinSummary:
    message_id: UUID
    sequence: int
    pinned_by_user_id: UUID
    pinned_at: datetime


@dataclass(frozen=True, slots=True)
class ListMessagePinsQuery:
    actor_user_id: UUID
    conversation_id: UUID


@dataclass(frozen=True, slots=True)
class SetMessagePinCommand:
    actor_user_id: UUID
    conversation_id: UUID
    message_id: UUID
    active: bool


def summarize_pin(pin: MessagePin, sequence: int) -> MessagePinSummary:
    return MessagePinSummary(
        message_id=pin.message_id,
        sequence=sequence,
        pinned_by_user_id=pin.pinned_by_user_id,
        pinned_at=pin.pinned_at,
    )


class ListMessagePins:
    def __init__(self, *, unit_of_work: MessagingUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, query: ListMessagePinsQuery) -> list[MessagePinSummary]:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(query.conversation_id),
                query.actor_user_id,
            )
            pins = await unit_of_work.pins.list_active(
                conversation_id=conversation.id,
                now=self._clock.now(),
            )
            return [summarize_pin(pin, sequence) for pin, sequence in pins]


class SetMessagePin:
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

    async def execute(self, command: SetMessagePinCommand) -> list[MessagePinSummary]:
        sync_events: list[PendingSyncEvent] = []
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            conversation, membership = require_active_membership(
                await unit_of_work.conversations.get_by_id(
                    command.conversation_id,
                    for_update=True,
                ),
                command.actor_user_id,
            )
            if conversation.conversation_type is ConversationType.GROUP and membership.role not in {
                ConversationMemberRole.OWNER,
                ConversationMemberRole.ADMIN,
            }:
                raise AuthorizationDeniedError("message pin mutation is not allowed")
            message = await unit_of_work.messages.get_by_id(command.message_id)
            now = self._clock.now()
            if (
                message is None
                or message.conversation_id != conversation.id
                or message.is_deleted
                or message.expires_at <= now
            ):
                raise MessageNotFoundError("message not found in conversation")

            exists = await unit_of_work.pins.exists(
                conversation_id=conversation.id,
                message_id=message.id,
            )
            changed = False
            if command.active and not exists:
                if (
                    await unit_of_work.pins.count_active(
                        conversation_id=conversation.id,
                        now=now,
                    )
                    >= MAX_MESSAGE_PINS_PER_CONVERSATION
                ):
                    raise MessagePinLimitError("message pin limit reached")
                changed = await unit_of_work.pins.add(
                    MessagePin(
                        conversation_id=conversation.id,
                        message_id=message.id,
                        pinned_by_user_id=command.actor_user_id,
                        pinned_at=now,
                    )
                )
            elif not command.active and exists:
                changed = await unit_of_work.pins.remove(
                    conversation_id=conversation.id,
                    message_id=message.id,
                )

            if changed:
                recipients = {member.user_id for member in conversation.members if member.is_active}
                sync_events = events_for_users(
                    recipients,
                    event_type=SyncEventType.MESSAGE_PIN_UPDATED,
                    conversation_id=conversation.id,
                    message_id=message.id,
                    actor_user_id=command.actor_user_id,
                    now=now,
                    policy=self._sync_policy,
                )
                await unit_of_work.sync_events.append(sync_events)
            pins = await unit_of_work.pins.list_active(
                conversation_id=conversation.id,
                now=now,
            )
            await unit_of_work.commit()
        if sync_events:
            await publish_best_effort(
                self._realtime_notifier,
                notifications_from_sync(sync_events),
            )
        return [summarize_pin(pin, sequence) for pin, sequence in pins]
