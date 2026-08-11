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
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
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
        sync_policy: SyncPolicy,
        realtime_notifier: RealtimeNotifier,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._sync_policy = sync_policy
        self._realtime_notifier = realtime_notifier

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
            now = self._clock.now()
            updated = conversation.change_member_role(
                command.target_user_id,
                command.role,
                now,
            )
            await unit_of_work.conversations.update(updated)
            sync_events = events_for_users(
                {member.user_id for member in updated.members if member.is_active},
                event_type=SyncEventType.CONVERSATION_UPDATED,
                conversation_id=updated.id,
                message_id=None,
                now=now,
                policy=self._sync_policy,
            )
            await unit_of_work.sync_events.append(sync_events)
            result = await build_conversation_result(updated, unit_of_work.users)
            await unit_of_work.commit()
        await publish_best_effort(self._realtime_notifier, notifications_from_sync(sync_events))
        return result
