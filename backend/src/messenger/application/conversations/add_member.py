"""Add one active account to a managed group."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
    require_group_manager,
)
from messenger.application.conversations.dto import (
    ConversationResult,
    build_conversation_result,
)
from messenger.application.errors import (
    ConversationMembershipConflictError,
    ConversationParticipantNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class AddConversationMemberCommand:
    actor_user_id: UUID
    conversation_id: UUID
    target_user_id: UUID


class AddConversationMember:
    def __init__(
        self,
        *,
        unit_of_work: ConversationUnitOfWorkFactory,
        clock: Clock,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: AddConversationMemberCommand) -> ConversationResult:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            conversation, actor = require_active_membership(
                await unit_of_work.conversations.get_by_id(
                    command.conversation_id,
                    for_update=True,
                ),
                command.actor_user_id,
            )
            require_group_manager(conversation, actor)
            target = await unit_of_work.users.get_by_id(command.target_user_id)
            if target is None or not target.is_active:
                raise ConversationParticipantNotFoundError("participant not found")
            if any(member.user_id == command.target_user_id for member in conversation.members):
                raise ConversationMembershipConflictError("participant already has membership")
            updated = conversation.add_member(command.target_user_id, self._clock.now())
            await unit_of_work.conversations.update(updated)
            result = await build_conversation_result(updated, unit_of_work.users)
            await unit_of_work.commit()
        return result
