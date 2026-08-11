"""Create or retrieve the current atomic MLS bootstrap snapshot."""

from dataclasses import dataclass
from uuid import UUID, uuid5

from messenger.application.conversation_crypto.dto import ConversationCryptoResult
from messenger.application.conversation_crypto.materialize import materialize_generation
from messenger.application.errors import (
    ConversationCryptoConflictError,
    ConversationNotFoundError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWorkFactory
from messenger.domain.entities import (
    ConversationCryptoBlockReason,
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    ConversationCryptoStatus,
)


@dataclass(frozen=True, slots=True)
class BeginConversationCryptoCommand:
    user_id: UUID
    device_id: UUID
    conversation_id: UUID
    bootstrap_request_id: UUID


class BeginConversationCrypto:
    def __init__(self, *, unit_of_work: ConversationCryptoUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: BeginConversationCryptoCommand) -> ConversationCryptoResult:
        async with self._unit_of_work() as uow:
            device = await uow.devices.get_owned_by_id(
                user_id=command.user_id,
                device_id=command.device_id,
                for_update=True,
            )
            if device is None or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")
            conversation = await uow.conversations.get_by_id(
                command.conversation_id,
                for_update=True,
            )
            if conversation is None or conversation.active_member(command.user_id) is None:
                raise ConversationNotFoundError("conversation not found")

            retry = await uow.generations.get_by_bootstrap_request(
                coordinator_device_id=command.device_id,
                bootstrap_request_id=command.bootstrap_request_id,
                for_update=True,
            )
            if retry is not None:
                if retry.conversation_id != command.conversation_id:
                    raise ConversationCryptoConflictError(
                        "bootstrap request is bound to another conversation"
                    )
                return await materialize_generation(uow, retry)

            current = await uow.generations.get_current(
                command.conversation_id,
                for_update=True,
            )
            if current is not None and current.status is not ConversationCryptoStatus.BLOCKED:
                return await materialize_generation(uow, current)

            now = self._clock.now()
            if current is not None:
                await uow.generations.update(current.supersede(now))
            generation = ConversationCryptoGeneration.create(
                conversation_id=command.conversation_id,
                generation_number=(
                    await uow.generations.latest_generation_number(command.conversation_id)
                )
                + 1,
                coordinator_user_id=command.user_id,
                coordinator_device_id=command.device_id,
                bootstrap_request_id=command.bootstrap_request_id,
                now=now,
            )
            active_user_ids = {
                member.user_id for member in conversation.members if member.is_active
            }
            active_devices = await uow.devices.list_active_for_users(active_user_ids)
            required = tuple(
                ConversationCryptoRequiredDevice(
                    generation_id=generation.id,
                    user_id=item.user_id,
                    device_id=item.id,
                    is_coordinator=item.id == command.device_id,
                    key_package_id=None,
                    snapshot_at=now,
                )
                for item in active_devices
            )
            if not any(item.is_coordinator for item in required):
                raise OwnedDeviceNotFoundError("current device is unavailable")
            identity_ids = {
                identity.device_id
                for identity in await uow.identities.get_by_device_ids(
                    {item.device_id for item in required}
                )
            }
            missing_identity = any(item.device_id not in identity_ids for item in required)
            if missing_identity:
                generation = generation.block(ConversationCryptoBlockReason.MISSING_IDENTITY, now)
            else:
                targets = tuple(item for item in required if not item.is_coordinator)
                availability = {
                    item.device_id: await uow.key_packages.count_available(item.device_id)
                    for item in targets
                }
                if any(count <= 0 for count in availability.values()):
                    generation = generation.block(
                        ConversationCryptoBlockReason.MISSING_KEY_PACKAGE,
                        now,
                    )
                else:
                    claimed_required: list[ConversationCryptoRequiredDevice] = []
                    for item in required:
                        if item.is_coordinator:
                            claimed_required.append(item)
                            continue
                        key_package = await uow.key_packages.get_next_available_for_update(
                            item.device_id
                        )
                        if key_package is None:
                            raise ConversationCryptoConflictError(
                                "KeyPackage availability changed during bootstrap"
                            )
                        claimed = key_package.claim(
                            claimed_by_user_id=command.user_id,
                            claimed_by_device_id=command.device_id,
                            conversation_id=command.conversation_id,
                            request_id=uuid5(generation.id, str(item.device_id)),
                            now=now,
                        )
                        await uow.key_packages.update(claimed)
                        claimed_required.append(item.bind_key_package(claimed.id))
                    required = tuple(claimed_required)

            await uow.generations.add(generation)
            await uow.required_devices.add_many(required)
            await uow.commit()
            return await materialize_generation(uow, generation)
