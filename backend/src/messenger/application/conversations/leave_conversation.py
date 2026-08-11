"""Leave a group as the current non-owner member."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import AuthorizationDeniedError
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import ConversationMemberRole, ConversationType


@dataclass(frozen=True, slots=True)
class LeaveConversationCommand:
    actor_user_id: UUID
    conversation_id: UUID


class LeaveConversation:
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

    async def execute(self, command: LeaveConversationCommand) -> None:
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
                raise AuthorizationDeniedError("direct conversation membership is immutable")
            if actor.role is ConversationMemberRole.OWNER:
                raise AuthorizationDeniedError("group owner cannot leave")
            now = self._clock.now()
            recipients = {member.user_id for member in conversation.members if member.is_active}
            await unit_of_work.conversations.update(
                conversation.remove_member(command.actor_user_id, now)
            )
            await unit_of_work.sync_events.append(
                events_for_users(
                    recipients,
                    event_type=SyncEventType.CONVERSATION_UPDATED,
                    conversation_id=conversation.id,
                    message_id=None,
                    now=now,
                    policy=self._sync_policy,
                )
            )
            await unit_of_work.commit()
