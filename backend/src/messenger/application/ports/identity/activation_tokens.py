"""Activation-token repository port."""

from typing import Protocol
from uuid import UUID

from messenger.domain.entities import ActivationToken


class ActivationTokenRepository(Protocol):
    async def add(self, token: ActivationToken) -> None: ...

    async def get_by_hash_for_update(self, token_hash: str) -> ActivationToken | None: ...

    async def list_unconsumed_for_user_for_update(
        self,
        user_id: UUID,
    ) -> list[ActivationToken]: ...

    async def update_lifecycle(self, token: ActivationToken) -> None: ...
