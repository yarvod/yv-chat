"""List the available KeyPackage inventory for the current device."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_crypto.dto import DeviceKeyPackageInventoryResult
from messenger.application.errors import DeviceCryptoIdentityNotFoundError, OwnedDeviceNotFoundError
from messenger.application.ports.device_crypto import DeviceCryptoUnitOfWorkFactory


@dataclass(frozen=True, slots=True)
class ListDeviceKeyPackageInventoryQuery:
    user_id: UUID
    device_id: UUID


class ListDeviceKeyPackageInventory:
    def __init__(self, *, unit_of_work: DeviceCryptoUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    async def execute(
        self,
        query: ListDeviceKeyPackageInventoryQuery,
    ) -> DeviceKeyPackageInventoryResult:
        async with self._unit_of_work() as uow:
            device = await uow.devices.get_by_id(query.device_id)
            if device is None or device.user_id != query.user_id or device.revoked_at is not None:
                raise OwnedDeviceNotFoundError("current device is unavailable")
            if await uow.identities.get_by_device_id(query.device_id) is None:
                raise DeviceCryptoIdentityNotFoundError("device crypto identity not found")
            available_count = await uow.key_packages.count_available(query.device_id)
        return DeviceKeyPackageInventoryResult(query.device_id, available_count)
