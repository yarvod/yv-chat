"""Register one immutable public cryptographic identity for the current device."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_crypto.dto import DeviceCryptoIdentityResult
from messenger.application.devices.notify_roster_change import append_device_roster_events
from messenger.application.errors import (
    DeviceCryptoIdentityConflictError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.device_crypto import DeviceCryptoUnitOfWorkFactory
from messenger.application.sync.policy import SyncPolicy
from messenger.domain.entities import DeviceCryptoIdentity, DeviceKeyPackage


@dataclass(frozen=True, slots=True)
class RegisterDeviceCryptoIdentityCommand:
    user_id: UUID
    device_id: UUID
    credential_identity: bytes
    signature_public_key: bytes
    key_package: bytes


class RegisterDeviceCryptoIdentity:
    def __init__(
        self,
        *,
        unit_of_work: DeviceCryptoUnitOfWorkFactory,
        clock: Clock,
        sync_policy: SyncPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._sync_policy = sync_policy

    async def execute(
        self,
        command: RegisterDeviceCryptoIdentityCommand,
    ) -> DeviceCryptoIdentityResult:
        now = self._clock.now()
        candidate = DeviceCryptoIdentity.create(
            user_id=command.user_id,
            device_id=command.device_id,
            credential_identity=command.credential_identity,
            signature_public_key=command.signature_public_key,
            now=now,
        )
        candidate_package = DeviceKeyPackage.create(
            user_id=command.user_id,
            device_id=command.device_id,
            key_package=command.key_package,
            now=now,
        )

        async with self._unit_of_work() as uow:
            device = await uow.devices.get_by_id(command.device_id, for_update=True)
            if device is None or device.user_id != command.user_id or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")

            existing = await uow.identities.get_by_device_id(
                command.device_id,
                for_update=True,
            )
            if existing is not None:
                existing_package = await uow.key_packages.get_initial_by_device_id(
                    command.device_id
                )
                if (
                    existing_package is None
                    or not existing.matches(candidate)
                    or existing_package.package_ref != candidate_package.package_ref
                    or existing_package.key_package != candidate_package.key_package
                ):
                    raise DeviceCryptoIdentityConflictError("device crypto identity is immutable")
                return DeviceCryptoIdentityResult.from_entities(existing, existing_package)

            await uow.identities.add(candidate)
            await uow.key_packages.add(candidate_package)
            await append_device_roster_events(
                uow,
                user_id=command.user_id,
                now=now,
                policy=self._sync_policy,
            )
            await uow.commit()
            return DeviceCryptoIdentityResult.from_entities(candidate, candidate_package)
