"""Read the immutable public anchor of the current authenticated device."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_crypto.dto import DeviceCryptoIdentityResult
from messenger.application.errors import (
    DeviceCryptoIdentityConflictError,
    DeviceCryptoIdentityNotFoundError,
    OwnedDeviceNotFoundError,
)
from messenger.application.ports.device_crypto import DeviceCryptoUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class GetCurrentDeviceCryptoIdentityQuery:
    user_id: UUID
    device_id: UUID


class GetCurrentDeviceCryptoIdentity:
    def __init__(self, *, unit_of_work: DeviceCryptoUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(
        self,
        query: GetCurrentDeviceCryptoIdentityQuery,
    ) -> DeviceCryptoIdentityResult:
        async with self._unit_of_work() as uow:
            device = await uow.devices.get_by_id(query.device_id)
            if device is None or device.user_id != query.user_id or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")
            identity = await uow.identities.get_by_device_id(query.device_id)
            if identity is None:
                raise DeviceCryptoIdentityNotFoundError("device crypto identity is not registered")
            key_package = await uow.key_packages.get_initial_by_device_id(query.device_id)
            if key_package is None:
                raise DeviceCryptoIdentityConflictError("device crypto identity is incomplete")
            return DeviceCryptoIdentityResult.from_entities(identity, key_package)
