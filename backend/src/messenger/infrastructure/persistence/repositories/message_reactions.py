"""SQLAlchemy message reaction repository adapter."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import MessageReaction
from messenger.infrastructure.persistence.models import MessageModel, MessageReactionModel


class SqlAlchemyMessageReactionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_messages(
        self,
        *,
        conversation_id: UUID,
        message_ids: set[UUID],
    ) -> list[MessageReaction]:
        if not message_ids:
            return []
        models = (
            await self._session.scalars(
                select(MessageReactionModel)
                .join(MessageModel, MessageModel.id == MessageReactionModel.message_id)
                .where(
                    MessageModel.conversation_id == conversation_id,
                    MessageReactionModel.message_id.in_(message_ids),
                )
                .order_by(
                    MessageReactionModel.message_id,
                    MessageReactionModel.created_at,
                    MessageReactionModel.user_id,
                )
            )
        ).all()
        return [
            MessageReaction(model.message_id, model.user_id, model.reaction, model.created_at)
            for model in models
        ]

    async def add(
        self,
        *,
        message_id: UUID,
        user_id: UUID,
        reaction: str,
        created_at: datetime,
    ) -> bool:
        inserted = await self._session.scalar(
            insert(MessageReactionModel)
            .values(
                message_id=message_id,
                user_id=user_id,
                reaction=reaction,
                created_at=created_at,
            )
            .on_conflict_do_nothing()
            .returning(MessageReactionModel.message_id)
        )
        await self._session.flush()
        return inserted is not None

    async def remove(self, *, message_id: UUID, user_id: UUID, reaction: str) -> bool:
        deleted = await self._session.scalar(
            delete(MessageReactionModel)
            .where(
                MessageReactionModel.message_id == message_id,
                MessageReactionModel.user_id == user_id,
                MessageReactionModel.reaction == reaction,
            )
            .returning(MessageReactionModel.message_id)
        )
        await self._session.flush()
        return deleted is not None
