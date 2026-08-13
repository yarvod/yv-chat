"""Opaque device-history relay persistence port."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from messenger.domain.entities import DeviceHistoryChunk


class DeviceHistoryChunkRepository(Protocol):
    async def add(self, chunk: DeviceHistoryChunk) -> DeviceHistoryChunk: ...

    async def get_by_client_id(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        client_chunk_id: UUID,
    ) -> DeviceHistoryChunk | None: ...

    async def get_by_id_for_update(self, chunk_id: UUID) -> DeviceHistoryChunk | None: ...

    async def count_direction_conversation(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        conversation_id: UUID,
    ) -> int: ...

    async def list_pending_for_target(
        self,
        *,
        pairing_id: UUID,
        target_device_id: UUID,
        after_sequence: int,
        now: datetime,
        limit: int,
    ) -> list[DeviceHistoryChunk]: ...

    async def list_for_sender(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        now: datetime,
        limit: int,
    ) -> list[DeviceHistoryChunk]: ...

    async def update(self, chunk: DeviceHistoryChunk) -> None: ...
