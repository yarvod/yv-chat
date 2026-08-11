"""Atomically claim one target device KeyPackage for an authorized conversation."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_crypto.dto import ClaimedDeviceKeyPackageResult
from messenger.application.errors import (
    ConversationNotFoundError,
    DeviceCryptoIdentityNotFoundError,
    DeviceKeyPackageConflictError,
    DeviceKeyPackageUnavailableError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.device_crypto import DeviceCryptoUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ClaimDeviceKeyPackageCommand:
    user_id: UUID
    device_id: UUID
    conversation_id: UUID
    target_device_id: UUID
    claim_request_id: UUID


class ClaimDeviceKeyPackage:
    def __init__(self, *, unit_of_work: DeviceCryptoUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: ClaimDeviceKeyPackageCommand) -> ClaimedDeviceKeyPackageResult:
        async with self._unit_of_work() as uow:
            claiming_device = await uow.devices.get_by_id(command.device_id, for_update=True)
            if (
                claiming_device is None
                or claiming_device.user_id != command.user_id
                or claiming_device.revoked_at is not None
            ):
                raise OwnedDeviceNotFoundError("current device is unavailable")
            conversation = await uow.conversations.get_by_id(command.conversation_id)
            if conversation is None or conversation.active_member(command.user_id) is None:
                raise ConversationNotFoundError("conversation not found")
            target = await uow.devices.get_by_id(command.target_device_id)
            if (
                target is None
                or target.revoked_at is not None
                or target.id == command.device_id
                or conversation.active_member(target.user_id) is None
            ):
                raise ConversationNotFoundError("conversation target not found")
            identity = await uow.identities.get_by_device_id(target.id)
            if identity is None:
                raise DeviceCryptoIdentityNotFoundError("target identity not found")
            existing = await uow.key_packages.get_by_claim_request(
                claiming_device_id=command.device_id,
                request_id=command.claim_request_id,
                for_update=True,
            )
            if existing is not None:
                if (
                    existing.claim_conversation_id != command.conversation_id
                    or existing.device_id != command.target_device_id
                ):
                    raise DeviceKeyPackageConflictError("claim request has another binding")
                return ClaimedDeviceKeyPackageResult.from_entities(identity, existing)
            key_package = await uow.key_packages.get_next_available_for_update(target.id)
            if key_package is None:
                raise DeviceKeyPackageUnavailableError("target has no available KeyPackage")
            claimed = key_package.claim(
                claimed_by_user_id=command.user_id,
                claimed_by_device_id=command.device_id,
                conversation_id=command.conversation_id,
                request_id=command.claim_request_id,
                now=self._clock.now(),
            )
            await uow.key_packages.update(claimed)
            await uow.commit()
            return ClaimedDeviceKeyPackageResult.from_entities(identity, claimed)
