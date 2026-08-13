"""Registration invitation persistence port."""

from typing import Protocol
from uuid import UUID

from messenger.domain.entities import RegistrationInvitation


class RegistrationInvitationRepository(Protocol):
    async def add(self, invitation: RegistrationInvitation) -> None: ...

    async def get_by_hash_for_update(
        self,
        token_hash: str,
    ) -> RegistrationInvitation | None: ...

    async def get_by_id_for_update(
        self,
        invitation_id: UUID,
    ) -> RegistrationInvitation | None: ...

    async def list_recent(
        self,
        *,
        limit: int,
        offset: int,
    ) -> tuple[list[RegistrationInvitation], int]: ...

    async def update_lifecycle(self, invitation: RegistrationInvitation) -> None: ...
