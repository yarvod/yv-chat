"""SQLAlchemy message pin repository adapter."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from messenger.domain.entities import MessagePin
from messenger.infrastructure.persistence.models import MessageModel, MessagePinModel


class SqlAlchemyMessagePinRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _active_conditions(
        conversation_id: UUID,
        now: datetime,
    ) -> tuple[ColumnElement[bool], ...]:
        return (
            MessagePinModel.conversation_id == conversation_id,
            MessageModel.conversation_id == conversation_id,
            MessageModel.deleted_at.is_(None),
            MessageModel.expires_at > now,
        )

    async def list_active(
        self,
        *,
        conversation_id: UUID,
        now: datetime,
    ) -> list[tuple[MessagePin, int]]:
        rows = (
            await self._session.execute(
                select(MessagePinModel, MessageModel.sequence)
                .join(MessageModel, MessageModel.id == MessagePinModel.message_id)
                .where(*self._active_conditions(conversation_id, now))
                .order_by(MessagePinModel.pinned_at.desc(), MessagePinModel.message_id)
            )
        ).all()
        return [
            (
                MessagePin(
                    conversation_id=model.conversation_id,
                    message_id=model.message_id,
                    pinned_by_user_id=model.pinned_by_user_id,
                    pinned_at=model.pinned_at,
                ),
                int(sequence),
            )
            for model, sequence in rows
        ]

    async def exists(self, *, conversation_id: UUID, message_id: UUID) -> bool:
        return (
            await self._session.scalar(
                select(MessagePinModel.message_id).where(
                    MessagePinModel.conversation_id == conversation_id,
                    MessagePinModel.message_id == message_id,
                )
            )
        ) is not None

    async def count_active(self, *, conversation_id: UUID, now: datetime) -> int:
        count = await self._session.scalar(
            select(func.count())
            .select_from(MessagePinModel)
            .join(MessageModel, MessageModel.id == MessagePinModel.message_id)
            .where(*self._active_conditions(conversation_id, now))
        )
        return int(count or 0)

    async def add(self, pin: MessagePin) -> bool:
        inserted = await self._session.scalar(
            insert(MessagePinModel)
            .values(
                message_id=pin.message_id,
                conversation_id=pin.conversation_id,
                pinned_by_user_id=pin.pinned_by_user_id,
                pinned_at=pin.pinned_at,
            )
            .on_conflict_do_nothing()
            .returning(MessagePinModel.message_id)
        )
        await self._session.flush()
        return inserted is not None

    async def remove(self, *, conversation_id: UUID, message_id: UUID) -> bool:
        deleted = await self._session.scalar(
            delete(MessagePinModel)
            .where(
                MessagePinModel.conversation_id == conversation_id,
                MessagePinModel.message_id == message_id,
            )
            .returning(MessagePinModel.message_id)
        )
        await self._session.flush()
        return deleted is not None
