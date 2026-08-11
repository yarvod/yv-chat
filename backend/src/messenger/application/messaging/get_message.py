"""Read one authorized opaque message or tombstone by id."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import MessageNotFoundError
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.domain.entities import Message


@dataclass(frozen=True, slots=True)
class GetMessageQuery:
    actor_user_id: UUID
    conversation_id: UUID
    message_id: UUID


class GetMessage:
    def __init__(self, *, unit_of_work: MessagingUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: GetMessageQuery) -> Message:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(query.conversation_id),
                query.actor_user_id,
            )
            message = await unit_of_work.messages.get_by_id(query.message_id)
            if message is None or message.conversation_id != conversation.id:
                raise MessageNotFoundError("message not found in conversation")
            return message
