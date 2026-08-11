"""Persistence ports for public device cryptography records."""

from typing import Protocol
from uuid import UUID

from messenger.domain.entities import DeviceCryptoIdentity, DeviceKeyPackage


class DeviceCryptoIdentityRepository(Protocol):
    async def get_by_device_id(
        self,
        device_id: UUID,
        *,
        for_update: bool = False,
    ) -> DeviceCryptoIdentity | None: ...

    async def add(self, identity: DeviceCryptoIdentity) -> None: ...


class DeviceKeyPackageRepository(Protocol):
    async def get_initial_by_device_id(
        self,
        device_id: UUID,
    ) -> DeviceKeyPackage | None: ...

    async def add(self, key_package: DeviceKeyPackage) -> None: ...
