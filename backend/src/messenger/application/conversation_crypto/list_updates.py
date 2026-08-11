"""List ordered ready MLS generations visible to the current device."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversation_crypto.dto import ConversationCryptoResult
from messenger.application.conversation_crypto.materialize import materialize_generation
from messenger.application.errors import (
    ConversationNotFoundError,
    InvalidConversationCryptoUpdateBoundsError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ListConversationCryptoUpdatesQuery:
    user_id: UUID
    device_id: UUID
    conversation_id: UUID
    after_generation_number: int
    limit: int = 100


class ListConversationCryptoUpdates:
    def __init__(self, *, unit_of_work: ConversationCryptoUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(
        self,
        query: ListConversationCryptoUpdatesQuery,
    ) -> tuple[ConversationCryptoResult, ...]:
        if query.after_generation_number < 0 or not 1 <= query.limit <= 100:
            raise InvalidConversationCryptoUpdateBoundsError("invalid crypto update bounds")
        async with self._unit_of_work() as uow:
            device = await uow.devices.get_owned_by_id(
                user_id=query.user_id,
                device_id=query.device_id,
            )
            if device is None or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")
            conversation = await uow.conversations.get_by_id(query.conversation_id)
            if conversation is None or conversation.active_member(query.user_id) is None:
                raise ConversationNotFoundError("conversation not found")
            generations = await uow.generations.list_ready_for_device_after(
                conversation_id=query.conversation_id,
                device_id=query.device_id,
                after_generation_number=query.after_generation_number,
                limit=query.limit,
            )
            return tuple(
                [
                    await materialize_generation(
                        uow,
                        generation,
                        welcome=await uow.welcomes.get_for_device(
                            generation_id=generation.id,
                            device_id=query.device_id,
                        ),
                    )
                    for generation in generations
                ]
            )
