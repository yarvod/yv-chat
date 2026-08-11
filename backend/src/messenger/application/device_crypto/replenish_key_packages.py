"""Atomically replenish the current device public KeyPackage pool."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_crypto.dto import ReplenishDeviceKeyPackagesResult
from messenger.application.errors import (
    DeviceCryptoIdentityNotFoundError,
    DeviceKeyPackageConflictError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.device_crypto import DeviceCryptoUnitOfWorkFactory
from messenger.domain.entities import DeviceKeyPackage
from messenger.domain.entities.device_crypto_identity import (
    MAX_KEY_PACKAGE_BATCH,
    MAX_KEY_PACKAGE_BATCH_BYTES,
)
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class ReplenishDeviceKeyPackagesCommand:
    user_id: UUID
    device_id: UUID
    key_packages: tuple[bytes, ...]


class ReplenishDeviceKeyPackages:
    def __init__(self, *, unit_of_work: DeviceCryptoUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(
        self, command: ReplenishDeviceKeyPackagesCommand
    ) -> ReplenishDeviceKeyPackagesResult:
        if not 1 <= len(command.key_packages) <= MAX_KEY_PACKAGE_BATCH:
            raise DomainValidationError("KeyPackage batch has invalid count")
        if sum(map(len, command.key_packages)) > MAX_KEY_PACKAGE_BATCH_BYTES:
            raise DomainValidationError("KeyPackage batch is too large")
        now = self._clock.now()
        candidates = tuple(
            DeviceKeyPackage.create(
                user_id=command.user_id,
                device_id=command.device_id,
                key_package=package,
                now=now,
            )
            for package in command.key_packages
        )
        refs = {candidate.package_ref for candidate in candidates}
        if len(refs) != len(candidates):
            raise DeviceKeyPackageConflictError("duplicate KeyPackage in batch")
        async with self._unit_of_work() as uow:
            device = await uow.devices.get_by_id(command.device_id, for_update=True)
            if device is None or device.user_id != command.user_id or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")
            if await uow.identities.get_by_device_id(command.device_id) is None:
                raise DeviceCryptoIdentityNotFoundError("device crypto identity not found")
            if await uow.key_packages.get_by_refs(refs):
                raise DeviceKeyPackageConflictError("KeyPackage is already registered")
            await uow.key_packages.add_many(candidates)
            available_count = await uow.key_packages.count_available(command.device_id)
            await uow.commit()
        return ReplenishDeviceKeyPackagesResult(
            device_id=command.device_id,
            added_count=len(candidates),
            available_count=available_count,
        )
