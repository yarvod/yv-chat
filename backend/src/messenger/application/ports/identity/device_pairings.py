"""Device-pairing persistence port."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import DevicePairing


class DevicePairingRepository(Protocol):
    async def add(self, pairing: DevicePairing) -> None: ...

    async def get_by_id(self, pairing_id: UUID) -> DevicePairing | None: ...

    async def get_by_id_for_update(self, pairing_id: UUID) -> DevicePairing | None: ...

    async def update(self, pairing: DevicePairing) -> None: ...

    async def lock_history_pair(
        self,
        *,
        user_id: UUID,
        first_device_id: UUID,
        second_device_id: UUID,
    ) -> None: ...

    async def cancel_other_active_history_syncs(
        self,
        *,
        pairing_id: UUID,
        user_id: UUID,
        first_device_id: UUID,
        second_device_id: UUID,
        now: datetime,
    ) -> None: ...

    async def prune_expired(self, *, before: datetime) -> None: ...
