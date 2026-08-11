"""SQLAlchemy opaque message repository adapter."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import Message
from messenger.infrastructure.persistence.models import MessageModel


class SqlAlchemyMessageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, message: Message) -> None:
        self._session.add(
            MessageModel(
                id=message.id,
                client_message_id=message.client_message_id,
                conversation_id=message.conversation_id,
                sender_user_id=message.sender_user_id,
                sender_device_id=message.sender_device_id,
                protocol_version=message.protocol_version,
                sequence=message.sequence,
                ciphertext=message.ciphertext,
                created_at=message.created_at,
            )
        )
        await self._session.flush()

    async def get_by_client_id(
        self,
        *,
        sender_device_id: UUID,
        client_message_id: UUID,
    ) -> Message | None:
        model = await self._session.scalar(
            select(MessageModel).where(
                MessageModel.sender_device_id == sender_device_id,
                MessageModel.client_message_id == client_message_id,
            )
        )
        return map_message(model) if model is not None else None

    async def next_sequence(self, conversation_id: UUID) -> int:
        maximum = await self._session.scalar(
            select(func.max(MessageModel.sequence)).where(
                MessageModel.conversation_id == conversation_id
            )
        )
        return (maximum or 0) + 1

    async def list_after(
        self,
        *,
        conversation_id: UUID,
        after_sequence: int,
        limit: int,
    ) -> list[Message]:
        models = (
            await self._session.scalars(
                select(MessageModel)
                .where(
                    MessageModel.conversation_id == conversation_id,
                    MessageModel.sequence > after_sequence,
                )
                .order_by(MessageModel.sequence, MessageModel.id)
                .limit(limit)
            )
        ).all()
        return [map_message(model) for model in models]


def map_message(model: MessageModel) -> Message:
    return Message(
        id=model.id,
        client_message_id=model.client_message_id,
        conversation_id=model.conversation_id,
        sender_user_id=model.sender_user_id,
        sender_device_id=model.sender_device_id,
        protocol_version=model.protocol_version,
        sequence=model.sequence,
        ciphertext=model.ciphertext,
        created_at=model.created_at,
    )
