"""Opaque message repository port."""

from datetime import datetime, timedelta
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import Message


class MessageRepository(Protocol):
    async def add(self, message: Message) -> None: ...

    async def get_by_client_id(
        self,
        *,
        sender_device_id: UUID,
        client_message_id: UUID,
    ) -> Message | None: ...

    async def get_by_id(
        self,
        message_id: UUID,
        *,
        for_update: bool = False,
    ) -> Message | None: ...

    async def next_sequence(self, conversation_id: UUID, *, activity_at: datetime) -> int: ...

    async def exists_at_sequence(
        self,
        *,
        conversation_id: UUID,
        sequence: int,
    ) -> bool: ...

    async def list_after(
        self,
        *,
        conversation_id: UUID,
        after_sequence: int,
        limit: int,
    ) -> list[Message]: ...

    async def list_before(
        self,
        *,
        conversation_id: UUID,
        before_sequence: int | None,
        limit: int,
    ) -> list[Message]: ...

    async def update(self, message: Message) -> None: ...

    async def list_expired_active(
        self,
        *,
        now: datetime,
        limit: int,
    ) -> list[Message]: ...

    async def purge_expired_tombstones(
        self,
        *,
        now: datetime,
        limit: int,
    ) -> int: ...

    async def extend_active_retention(self, retention: timedelta) -> int: ...
