"""Authorize and publish one short-lived typing state transition."""

from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime.events import RealtimeEventType, RealtimeNotification
from messenger.application.realtime.publish import publish_best_effort


@dataclass(frozen=True, slots=True)
class TypingPolicy:
    active_ttl: timedelta = timedelta(seconds=5)

    def __post_init__(self) -> None:
        if not timedelta(seconds=1) <= self.active_ttl <= timedelta(seconds=30):
            raise ValueError("typing active TTL is out of bounds")


@dataclass(frozen=True, slots=True)
class PublishTypingCommand:
    actor_user_id: UUID
    conversation_id: UUID
    active: bool


class PublishTyping:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        clock: Clock,
        policy: TypingPolicy,
        realtime_notifier: RealtimeNotifier,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = policy
        self._realtime_notifier = realtime_notifier

    async def execute(self, command: PublishTypingCommand) -> None:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(command.conversation_id),
                command.actor_user_id,
            )
            recipients = {
                member.user_id
                for member in conversation.members
                if member.is_active and member.user_id != command.actor_user_id
            }
        now = self._clock.now()
        expires_at = now + self._policy.active_ttl if command.active else now
        notifications = tuple(
            RealtimeNotification(
                user_id=user_id,
                event_id=uuid4(),
                event_type=RealtimeEventType.TYPING,
                conversation_id=conversation.id,
                message_id=None,
                actor_user_id=command.actor_user_id,
                read_sequence=None,
                typing_active=command.active,
                expires_at=expires_at,
            )
            for user_id in sorted(recipients, key=lambda value: value.int)
        )
        await publish_best_effort(self._realtime_notifier, notifications)
