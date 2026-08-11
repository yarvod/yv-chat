"""Return the authorized current MLS generation and this device's Welcome."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversation_crypto.dto import ConversationCryptoResult
from messenger.application.conversation_crypto.materialize import materialize_generation
from messenger.application.errors import (
    ConversationCryptoNotFoundError,
    ConversationNotFoundError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class GetCurrentConversationCryptoQuery:
    user_id: UUID
    device_id: UUID
    conversation_id: UUID


class GetCurrentConversationCrypto:
    def __init__(self, *, unit_of_work: ConversationCryptoUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(self, query: GetCurrentConversationCryptoQuery) -> ConversationCryptoResult:
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
            generation = await uow.generations.get_current(query.conversation_id)
            if generation is None:
                raise ConversationCryptoNotFoundError("current crypto generation not found")
            required = await uow.required_devices.list_by_generation(generation.id)
            if query.device_id not in {item.device_id for item in required}:
                raise ConversationCryptoNotFoundError("current device is outside crypto roster")
            welcome = await uow.welcomes.get_for_device(
                generation_id=generation.id,
                device_id=query.device_id,
            )
            return await materialize_generation(uow, generation, welcome=welcome)
