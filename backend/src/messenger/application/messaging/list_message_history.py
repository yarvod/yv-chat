"""Read a bounded latest or exclusive-before page of opaque envelopes."""

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
class ListMessageHistoryQuery:
    actor_user_id: UUID
    conversation_id: UUID
    before_sequence: int | None = None
    limit: int = 50


@dataclass(frozen=True, slots=True)
class MessageHistoryPage:
    messages: tuple[Message, ...]
    has_more: bool
    oldest_sequence: int | None
    newest_sequence: int | None


class ListMessageHistory:
    def __init__(self, *, unit_of_work: MessagingUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: ListMessageHistoryQuery) -> MessageHistoryPage:
        if (
            query.limit < 1
            or query.limit > 100
            or (query.before_sequence is not None and query.before_sequence <= 0)
        ):
            raise InvalidMessageEnvelopeError("invalid message history page bounds")
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(query.conversation_id),
                query.actor_user_id,
            )
            fetched = await unit_of_work.messages.list_before(
                conversation_id=conversation.id,
                before_sequence=query.before_sequence,
                limit=query.limit + 1,
            )
        has_more = len(fetched) > query.limit
        messages = tuple(fetched[-query.limit :])
        return MessageHistoryPage(
            messages=messages,
            has_more=has_more,
            oldest_sequence=messages[0].sequence if messages else None,
            newest_sequence=messages[-1].sequence if messages else None,
        )
