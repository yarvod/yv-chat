"""Opaque-session repository port."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from messenger.application.ports.identity.records import (
    DeviceSessionRecord,
    SessionCredentialMatch,
)
from messenger.domain.entities import Session


class SessionRepository(Protocol):
    async def add(self, session: Session) -> None: ...

    async def get_by_token_hash_for_update(
        self,
        token_hash: str,
    ) -> SessionCredentialMatch | None: ...

    async def update(self, session: Session) -> None: ...

    async def list_active_with_devices(
        self,
        *,
        user_id: UUID,
        now: datetime,
    ) -> list[DeviceSessionRecord]: ...

    async def get_by_device_for_user_for_update(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
    ) -> DeviceSessionRecord | None: ...

    async def list_for_user_for_update(self, user_id: UUID) -> list[DeviceSessionRecord]: ...
