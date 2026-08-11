"""Idempotently acknowledge delivery of this device's MLS Welcome."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.errors import (
    ConversationCryptoNotFoundError,
    ConversationNotFoundError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class AcknowledgeConversationCryptoWelcomeCommand:
    user_id: UUID
    device_id: UUID
    conversation_id: UUID
    generation_id: UUID


class AcknowledgeConversationCryptoWelcome:
    def __init__(self, *, unit_of_work: ConversationCryptoUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: AcknowledgeConversationCryptoWelcomeCommand) -> None:
        async with self._unit_of_work() as uow:
            device = await uow.devices.get_owned_by_id(
                user_id=command.user_id,
                device_id=command.device_id,
            )
            if device is None or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")
            conversation = await uow.conversations.get_by_id(command.conversation_id)
            if conversation is None or conversation.active_member(command.user_id) is None:
                raise ConversationNotFoundError("conversation not found")
            generation = await uow.generations.get_by_id(command.generation_id)
            if (
                generation is None
                or generation.conversation_id != command.conversation_id
                or not generation.is_current
            ):
                raise ConversationCryptoNotFoundError("current crypto generation not found")
            welcome = await uow.welcomes.get_for_device(
                generation_id=generation.id,
                device_id=command.device_id,
                for_update=True,
            )
            if welcome is None:
                raise ConversationCryptoNotFoundError("device Welcome not found")
            acknowledged = welcome.acknowledge(self._clock.now())
            if acknowledged != welcome:
                await uow.welcomes.update(acknowledged)
                await uow.commit()
