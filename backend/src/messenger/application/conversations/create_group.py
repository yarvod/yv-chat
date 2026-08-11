"""Create a group with initial ordinary members."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import require_active_actor
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
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import Conversation


@dataclass(frozen=True, slots=True)
class CreateGroupConversationCommand:
    actor_user_id: UUID
    title: str
    member_user_ids: tuple[UUID, ...] = ()


class CreateGroupConversation:
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
        command: CreateGroupConversationCommand,
    ) -> ConversationResult:
        requested = set(command.member_user_ids)
        if len(requested) != len(command.member_user_ids) or command.actor_user_id in requested:
            raise ConversationMembershipConflictError("group members must be unique")
        now = self._clock.now()
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            users = await unit_of_work.users.get_many_by_ids(requested)
            if len(users) != len(requested) or any(not user.is_active for user in users):
                raise ConversationParticipantNotFoundError("participant not found")
            conversation = Conversation.create_group(
                created_by=command.actor_user_id,
                title=command.title,
                now=now,
            )
            for user_id in command.member_user_ids:
                conversation = conversation.add_member(user_id, now)
            await unit_of_work.conversations.add(conversation)
            await unit_of_work.sync_events.append(
                events_for_users(
                    {member.user_id for member in conversation.members},
                    event_type=SyncEventType.CONVERSATION_UPDATED,
                    conversation_id=conversation.id,
                    message_id=None,
                    now=now,
                    policy=self._sync_policy,
                )
            )
            result = await build_conversation_result(conversation, unit_of_work.users)
            await unit_of_work.commit()
        return result
