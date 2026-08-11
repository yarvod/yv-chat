"""Password-reset token repository port."""

from typing import Protocol
from uuid import UUID

from messenger.domain.entities import PasswordResetToken


class PasswordResetTokenRepository(Protocol):
    async def add(self, token: PasswordResetToken) -> None: ...

    async def get_by_hash_for_update(self, token_hash: str) -> PasswordResetToken | None: ...

    async def list_unconsumed_for_user_for_update(
        self,
        user_id: UUID,
    ) -> list[PasswordResetToken]: ...

    async def update_lifecycle(self, token: PasswordResetToken) -> None: ...
