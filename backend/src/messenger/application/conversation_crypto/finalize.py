"""Finalize one pending MLS generation and enqueue device-bound Welcomes."""

from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from messenger.application.conversation_crypto.dto import ConversationCryptoResult
from messenger.application.conversation_crypto.materialize import materialize_generation
from messenger.application.errors import (
    ConversationCryptoConflictError,
    ConversationCryptoNotFoundError,
    ConversationCryptoNotReadyError,
    ConversationNotFoundError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWorkFactory
from messenger.domain.entities import (
    ConversationCryptoStatus,
    ConversationCryptoWelcome,
)

WELCOME_TTL = timedelta(days=30)


@dataclass(frozen=True, slots=True)
class DeviceWelcomeInput:
    target_device_id: UUID
    welcome_message: bytes


@dataclass(frozen=True, slots=True)
class FinalizeConversationCryptoCommand:
    user_id: UUID
    device_id: UUID
    conversation_id: UUID
    generation_id: UUID
    epoch: int
    commit_message: bytes
    ratchet_tree: bytes
    welcomes: tuple[DeviceWelcomeInput, ...]


class FinalizeConversationCrypto:
    def __init__(self, *, unit_of_work: ConversationCryptoUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: FinalizeConversationCryptoCommand) -> ConversationCryptoResult:
        async with self._unit_of_work() as uow:
            device = await uow.devices.get_owned_by_id(
                user_id=command.user_id,
                device_id=command.device_id,
                for_update=True,
            )
            if device is None or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")
            conversation = await uow.conversations.get_by_id(command.conversation_id)
            if conversation is None or conversation.active_member(command.user_id) is None:
                raise ConversationNotFoundError("conversation not found")
            generation = await uow.generations.get_by_id(command.generation_id, for_update=True)
            if (
                generation is None
                or generation.conversation_id != command.conversation_id
                or not generation.is_current
            ):
                raise ConversationCryptoNotFoundError("current crypto generation not found")
            if generation.coordinator_device_id != command.device_id:
                raise ConversationCryptoNotFoundError("current crypto generation not found")
            required = await uow.required_devices.list_by_generation(generation.id)
            expected_targets = {item.device_id for item in required if not item.is_coordinator}
            supplied_by_target = {item.target_device_id: item for item in command.welcomes}
            if len(supplied_by_target) != len(command.welcomes):
                raise ConversationCryptoConflictError("duplicate Welcome target")
            if set(supplied_by_target) != expected_targets:
                raise ConversationCryptoConflictError("Welcome target roster mismatch")
            if generation.status is ConversationCryptoStatus.READY:
                if (
                    generation.epoch != command.epoch
                    or generation.commit_message != command.commit_message
                    or generation.ratchet_tree != command.ratchet_tree
                ):
                    raise ConversationCryptoConflictError(
                        "finalize retry does not match ready generation"
                    )
                for target_device_id, supplied in supplied_by_target.items():
                    stored = await uow.welcomes.get_for_device(
                        generation_id=generation.id,
                        device_id=target_device_id,
                    )
                    if stored is None or stored.welcome_message != supplied.welcome_message:
                        raise ConversationCryptoConflictError(
                            "finalize retry has different Welcome bytes"
                        )
                return await materialize_generation(uow, generation)
            if generation.status is not ConversationCryptoStatus.PENDING:
                raise ConversationCryptoNotReadyError("crypto generation is blocked")

            now = self._clock.now()
            finalized = generation.finalize(
                epoch=command.epoch,
                commit_message=command.commit_message,
                ratchet_tree=command.ratchet_tree,
                now=now,
            )
            welcomes = tuple(
                ConversationCryptoWelcome(
                    generation_id=generation.id,
                    target_device_id=item.target_device_id,
                    welcome_message=item.welcome_message,
                    created_at=now,
                    expires_at=now + WELCOME_TTL,
                )
                for item in command.welcomes
            )
            await uow.welcomes.add_many(welcomes)
            await uow.generations.update(finalized)
            await uow.commit()
            return await materialize_generation(uow, finalized)
