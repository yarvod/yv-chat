"""List shared read cursors and actual unread counts without N+1 queries."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import require_active_actor
from messenger.application.ports.messages import (
    ConversationReadSummary,
    MessagingUnitOfWorkFactory,
)


@dataclass(frozen=True, slots=True)
class ListConversationReadStatesQuery:
    actor_user_id: UUID


class ListConversationReadStates:
    def __init__(self, *, unit_of_work: MessagingUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(
        self,
        query: ListConversationReadStatesQuery,
    ) -> list[ConversationReadSummary]:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversations = await unit_of_work.conversations.list_active_for_user(
                query.actor_user_id
            )
            return await unit_of_work.read_states.list_summaries(
                user_id=query.actor_user_id,
                conversation_ids={conversation.id for conversation in conversations},
            )
