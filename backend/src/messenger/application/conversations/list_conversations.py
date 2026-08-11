"""List active conversations for the current actor."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import require_active_actor
from messenger.application.conversations.dto import (
    ConversationResult,
    build_conversation_results,
)
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ListConversationsQuery:
    actor_user_id: UUID


class ListConversations:
    def __init__(self, *, unit_of_work: ConversationUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: ListConversationsQuery) -> list[ConversationResult]:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversations = await unit_of_work.conversations.list_active_for_user(
                query.actor_user_id
            )
            return await build_conversation_results(conversations, unit_of_work.users)
