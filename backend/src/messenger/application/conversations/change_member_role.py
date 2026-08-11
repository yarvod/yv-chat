"""Owner-only group member role change."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.conversations.dto import (
    ConversationResult,
    build_conversation_result,
)
from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationMembershipConflictError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory
from messenger.domain.entities import ConversationMemberRole, ConversationType


@dataclass(frozen=True, slots=True)
class ChangeConversationMemberRoleCommand:
    actor_user_id: UUID
    conversation_id: UUID
    target_user_id: UUID
    role: ConversationMemberRole


class ChangeConversationMemberRole:
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
        command: ChangeConversationMemberRoleCommand,
    ) -> ConversationResult:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            conversation, actor = require_active_membership(
                await unit_of_work.conversations.get_by_id(
                    command.conversation_id,
                    for_update=True,
                ),
                command.actor_user_id,
            )
            if conversation.conversation_type is not ConversationType.GROUP:
                raise AuthorizationDeniedError("direct conversation roles are immutable")
            if actor.role is not ConversationMemberRole.OWNER:
                raise AuthorizationDeniedError("group owner role required")
            target = conversation.active_member(command.target_user_id)
            if target is None:
                raise ConversationMembershipConflictError("active member not found")
            if target.role is ConversationMemberRole.OWNER:
                raise AuthorizationDeniedError("group owner role cannot be changed")
            updated = conversation.change_member_role(
                command.target_user_id,
                command.role,
                self._clock.now(),
            )
            await unit_of_work.conversations.update(updated)
            result = await build_conversation_result(updated, unit_of_work.users)
            await unit_of_work.commit()
        return result
