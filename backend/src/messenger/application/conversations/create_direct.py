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
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

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
            conversation = Conversation.create_direct(
                created_by=command.actor_user_id,
                other_user_id=command.other_user_id,
                now=self._clock.now(),
            )
            await unit_of_work.conversations.add(conversation)
            result = await build_conversation_result(conversation, unit_of_work.users)
            await unit_of_work.commit()
        return result
