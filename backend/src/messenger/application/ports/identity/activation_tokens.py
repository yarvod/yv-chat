"""Activation-token repository port."""

from typing import Protocol

from messenger.domain.entities import ActivationToken


class ActivationTokenRepository(Protocol):
    async def add(self, token: ActivationToken) -> None: ...

    async def get_by_hash_for_update(self, token_hash: str) -> ActivationToken | None: ...

    async def mark_used(self, token: ActivationToken) -> None: ...
