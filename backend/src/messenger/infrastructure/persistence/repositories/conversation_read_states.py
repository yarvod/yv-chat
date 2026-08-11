"""SQLAlchemy conversation read-state adapter."""

from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.ports.messages import ConversationReadSummary
from messenger.domain.entities import ConversationReadState
from messenger.infrastructure.persistence.models import (
    ConversationModel,
    ConversationReadStateModel,
    MessageModel,
)


class SqlAlchemyConversationReadStateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
    ) -> ConversationReadState | None:
        model = await self._session.get(
            ConversationReadStateModel,
            (user_id, conversation_id),
        )
        if model is None:
            return None
        return ConversationReadState(
            user_id=model.user_id,
            conversation_id=model.conversation_id,
            last_read_sequence=model.last_read_sequence,
            updated_at=model.updated_at,
        )

    async def upsert(self, state: ConversationReadState) -> None:
        await self._session.execute(
            insert(ConversationReadStateModel)
            .values(
                user_id=state.user_id,
                conversation_id=state.conversation_id,
                last_read_sequence=state.last_read_sequence,
                updated_at=state.updated_at,
            )
            .on_conflict_do_update(
                index_elements=[
                    ConversationReadStateModel.user_id,
                    ConversationReadStateModel.conversation_id,
                ],
                set_={
                    "last_read_sequence": state.last_read_sequence,
                    "updated_at": state.updated_at,
                },
                where=(ConversationReadStateModel.last_read_sequence < state.last_read_sequence),
            )
        )
        await self._session.flush()

    async def list_summaries(
        self,
        *,
        user_id: UUID,
        conversation_ids: set[UUID],
    ) -> list[ConversationReadSummary]:
        if not conversation_ids:
            return []
        read_cursor = func.coalesce(ConversationReadStateModel.last_read_sequence, 0)
        latest_sequence = func.coalesce(func.max(MessageModel.sequence), 0)
        unread_count = func.count(MessageModel.id).filter(MessageModel.sequence > read_cursor)
        rows = (
            await self._session.execute(
                select(
                    ConversationModel.id,
                    read_cursor,
                    latest_sequence,
                    unread_count,
                )
                .outerjoin(
                    ConversationReadStateModel,
                    and_(
                        ConversationReadStateModel.conversation_id == ConversationModel.id,
                        ConversationReadStateModel.user_id == user_id,
                    ),
                )
                .outerjoin(MessageModel, MessageModel.conversation_id == ConversationModel.id)
                .where(ConversationModel.id.in_(conversation_ids))
                .group_by(
                    ConversationModel.id,
                    ConversationReadStateModel.last_read_sequence,
                )
                .order_by(ConversationModel.id)
            )
        ).all()
        return [
            ConversationReadSummary(
                conversation_id=conversation_id,
                last_read_sequence=int(last_read),
                latest_sequence=int(latest),
                unread_count=int(unread),
            )
            for conversation_id, last_read, latest, unread in rows
        ]
