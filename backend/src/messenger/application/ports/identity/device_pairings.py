"""Device-pairing persistence port."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import DevicePairing


class DevicePairingRepository(Protocol):
    async def add(self, pairing: DevicePairing) -> None: ...

    async def get_by_id_for_update(self, pairing_id: UUID) -> DevicePairing | None: ...

    async def update(self, pairing: DevicePairing) -> None: ...

    async def prune_expired(self, *, before: datetime) -> None: ...
