"""List participant delivery aggregates for authorized conversations."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import require_active_actor
from messenger.application.ports.messages import (
    MessagingUnitOfWorkFactory,
    ParticipantDeliverySummary,
)


@dataclass(frozen=True, slots=True)
class ListParticipantDeliveryStatesQuery:
    actor_user_id: UUID


class ListParticipantDeliveryStates:
    def __init__(self, *, unit_of_work: MessagingUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(
        self, query: ListParticipantDeliveryStatesQuery
    ) -> list[ParticipantDeliverySummary]:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, query.actor_user_id)
            conversations = await unit_of_work.conversations.list_active_for_user(
                query.actor_user_id
            )
            return await unit_of_work.delivery_states.list_participant_summaries(
                conversation_ids={conversation.id for conversation in conversations}
            )
