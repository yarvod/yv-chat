"""Get one conversation without leaking inaccessible identifiers."""

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
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class GetConversationQuery:
    actor_user_id: UUID
    conversation_id: UUID


class GetConversation:
    def __init__(self, *, unit_of_work: ConversationUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: GetConversationQuery) -> ConversationResult:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(query.conversation_id),
                query.actor_user_id,
            )
            return await build_conversation_result(conversation, unit_of_work.users)
