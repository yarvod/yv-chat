"""SQLAlchemy opaque message repository adapter."""

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
                conversation_id=message.conversation_id,
                sender_user_id=message.sender_user_id,
                sender_device_id=message.sender_device_id,
                protocol_version=message.protocol_version,
                ciphertext=message.ciphertext,
                created_at=message.created_at,
            )
        )
        await self._session.flush()
