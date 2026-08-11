"""Remove one member within the explicit group role hierarchy."""

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
    AuthorizationDeniedError,
    ConversationMembershipConflictError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import ConversationMemberRole


@dataclass(frozen=True, slots=True)
class RemoveConversationMemberCommand:
    actor_user_id: UUID
    conversation_id: UUID
    target_user_id: UUID


class RemoveConversationMember:
    def __init__(
        self,
        *,
        unit_of_work: ConversationUnitOfWorkFactory,
        clock: Clock,
        sync_policy: SyncPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._sync_policy = sync_policy

    async def execute(
        self,
        command: RemoveConversationMemberCommand,
    ) -> ConversationResult:
        if command.actor_user_id == command.target_user_id:
            raise ConversationMembershipConflictError("use leave operation for current member")
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
            target = conversation.active_member(command.target_user_id)
            if target is None:
                raise ConversationMembershipConflictError("active member not found")
            if target.role is ConversationMemberRole.OWNER:
                raise AuthorizationDeniedError("group owner cannot be removed")
            if (
                actor.role is ConversationMemberRole.ADMIN
                and target.role is not ConversationMemberRole.MEMBER
            ):
                raise AuthorizationDeniedError("admin can remove ordinary members only")
            now = self._clock.now()
            recipients = {member.user_id for member in conversation.members if member.is_active}
            updated = conversation.remove_member(command.target_user_id, now)
            await unit_of_work.conversations.update(updated)
            await unit_of_work.sync_events.append(
                events_for_users(
                    recipients,
                    event_type=SyncEventType.CONVERSATION_UPDATED,
                    conversation_id=updated.id,
                    message_id=None,
                    now=now,
                    policy=self._sync_policy,
                )
            )
            result = await build_conversation_result(updated, unit_of_work.users)
            await unit_of_work.commit()
        return result
