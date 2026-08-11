"""Device repository port."""

from typing import Protocol
from uuid import UUID

from messenger.domain.entities import Device


class DeviceRepository(Protocol):
    async def get_by_id(self, device_id: UUID, *, for_update: bool = False) -> Device | None: ...

    async def get_owned_by_id(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
        for_update: bool = False,
    ) -> Device | None: ...

    async def list_active_for_users(self, user_ids: set[UUID]) -> list[Device]: ...

    async def add(self, device: Device) -> None: ...

    async def update(self, device: Device) -> None: ...
