"""SQLAlchemy opaque device-history relay repository."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import DeviceHistoryChunk
from messenger.infrastructure.persistence.models import DeviceHistoryChunkModel


def map_chunk(model: DeviceHistoryChunkModel) -> DeviceHistoryChunk:
    return DeviceHistoryChunk(
        id=model.id,
        pairing_id=model.pairing_id,
        sender_device_id=model.sender_device_id,
        target_device_id=model.target_device_id,
        conversation_id=model.conversation_id,
        client_chunk_id=model.client_chunk_id,
        ciphertext_base64=model.ciphertext_base64,
        created_at=model.created_at,
        expires_at=model.expires_at,
        server_sequence=model.server_sequence,
        acknowledged_at=model.acknowledged_at,
    )


class SqlAlchemyDeviceHistoryChunkRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, chunk: DeviceHistoryChunk) -> DeviceHistoryChunk:
        model = DeviceHistoryChunkModel(
            id=chunk.id,
            pairing_id=chunk.pairing_id,
            sender_device_id=chunk.sender_device_id,
            target_device_id=chunk.target_device_id,
            conversation_id=chunk.conversation_id,
            client_chunk_id=chunk.client_chunk_id,
            ciphertext_base64=chunk.ciphertext_base64,
            created_at=chunk.created_at,
            expires_at=chunk.expires_at,
            acknowledged_at=chunk.acknowledged_at,
        )
        self._session.add(model)
        await self._session.flush()
        return map_chunk(model)

    async def get_by_client_id(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        client_chunk_id: UUID,
    ) -> DeviceHistoryChunk | None:
        model = await self._session.scalar(
            select(DeviceHistoryChunkModel).where(
                DeviceHistoryChunkModel.pairing_id == pairing_id,
                DeviceHistoryChunkModel.sender_device_id == sender_device_id,
                DeviceHistoryChunkModel.client_chunk_id == client_chunk_id,
            )
        )
        return map_chunk(model) if model is not None else None

    async def get_by_id_for_update(self, chunk_id: UUID) -> DeviceHistoryChunk | None:
        model = await self._session.scalar(
            select(DeviceHistoryChunkModel)
            .where(DeviceHistoryChunkModel.id == chunk_id)
            .with_for_update()
        )
        return map_chunk(model) if model is not None else None

    async def count_direction_conversation(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        conversation_id: UUID,
    ) -> int:
        return int(
            await self._session.scalar(
                select(func.count())
                .select_from(DeviceHistoryChunkModel)
                .where(
                    DeviceHistoryChunkModel.pairing_id == pairing_id,
                    DeviceHistoryChunkModel.sender_device_id == sender_device_id,
                    DeviceHistoryChunkModel.conversation_id == conversation_id,
                )
            )
            or 0
        )

    async def list_pending_for_target(
        self,
        *,
        pairing_id: UUID,
        target_device_id: UUID,
        after_sequence: int,
        now: datetime,
        limit: int,
    ) -> list[DeviceHistoryChunk]:
        models = list(
            await self._session.scalars(
                select(DeviceHistoryChunkModel)
                .where(
                    DeviceHistoryChunkModel.pairing_id == pairing_id,
                    DeviceHistoryChunkModel.target_device_id == target_device_id,
                    DeviceHistoryChunkModel.server_sequence > after_sequence,
                    DeviceHistoryChunkModel.expires_at > now,
                    DeviceHistoryChunkModel.acknowledged_at.is_(None),
                )
                .order_by(DeviceHistoryChunkModel.server_sequence)
                .limit(limit)
            )
        )
        return [map_chunk(model) for model in models]

    async def update(self, chunk: DeviceHistoryChunk) -> None:
        model = await self._session.get(DeviceHistoryChunkModel, chunk.id)
        if model is None:
            raise RuntimeError("locked history chunk disappeared")
        model.acknowledged_at = chunk.acknowledged_at
        await self._session.flush()

    async def list_for_sender(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        now: datetime,
        limit: int,
    ) -> list[DeviceHistoryChunk]:
        models = list(
            await self._session.scalars(
                select(DeviceHistoryChunkModel)
                .where(
                    DeviceHistoryChunkModel.pairing_id == pairing_id,
                    DeviceHistoryChunkModel.sender_device_id == sender_device_id,
                    DeviceHistoryChunkModel.expires_at > now,
                )
                .order_by(DeviceHistoryChunkModel.server_sequence)
                .limit(limit)
            )
        )
        return [map_chunk(model) for model in models]
