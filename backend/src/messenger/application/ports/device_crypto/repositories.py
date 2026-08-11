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

    async def get_by_device_ids(
        self,
        device_ids: set[UUID],
    ) -> list[DeviceCryptoIdentity]: ...


class DeviceKeyPackageRepository(Protocol):
    async def get_initial_by_device_id(
        self,
        device_id: UUID,
    ) -> DeviceKeyPackage | None: ...

    async def add(self, key_package: DeviceKeyPackage) -> None: ...

    async def add_many(self, key_packages: tuple[DeviceKeyPackage, ...]) -> None: ...

    async def get_by_refs(self, package_refs: set[str]) -> list[DeviceKeyPackage]: ...

    async def get_by_ids(self, package_ids: set[UUID]) -> list[DeviceKeyPackage]: ...

    async def count_available(self, device_id: UUID) -> int: ...

    async def get_by_claim_request(
        self,
        *,
        claiming_device_id: UUID,
        request_id: UUID,
        for_update: bool = False,
    ) -> DeviceKeyPackage | None: ...

    async def get_next_available_for_update(
        self,
        device_id: UUID,
    ) -> DeviceKeyPackage | None: ...

    async def update(self, key_package: DeviceKeyPackage) -> None: ...
