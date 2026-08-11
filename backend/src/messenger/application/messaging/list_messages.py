"""Read one stable ascending page of opaque envelopes."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import InvalidMessageEnvelopeError
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.domain.entities import Message


@dataclass(frozen=True, slots=True)
class ListMessagesQuery:
    actor_user_id: UUID
    conversation_id: UUID
    after_sequence: int = 0
    limit: int = 50


class ListMessages:
    def __init__(self, *, unit_of_work: MessagingUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: ListMessagesQuery) -> list[Message]:
        if query.after_sequence < 0 or query.limit < 1 or query.limit > 100:
            raise InvalidMessageEnvelopeError("invalid message page bounds")
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(query.conversation_id),
                query.actor_user_id,
            )
            return await unit_of_work.messages.list_after(
                conversation_id=conversation.id,
                after_sequence=query.after_sequence,
                limit=query.limit,
            )
