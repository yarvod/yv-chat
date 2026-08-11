"""PostgreSQL per-user cursor stream adapter."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.sync import PendingSyncEvent, SyncEvent, SyncEventType
from messenger.application.sync.events import SyncStreamPage
from messenger.infrastructure.persistence.models import SyncEventModel, SyncStreamModel


class SqlAlchemySyncRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def append(self, events: list[PendingSyncEvent]) -> None:
        ordered_events = [
            event
            for user_id in sorted({item.user_id for item in events}, key=lambda value: value.int)
            for event in events
            if event.user_id == user_id
        ]
        for event in ordered_events:
            cursor = await self._session.scalar(
                insert(SyncStreamModel)
                .values(user_id=event.user_id, last_cursor=1)
                .on_conflict_do_update(
                    index_elements=[SyncStreamModel.user_id],
                    set_={"last_cursor": SyncStreamModel.last_cursor + 1},
                )
                .returning(SyncStreamModel.last_cursor)
            )
            if cursor is None:
                raise RuntimeError("sync cursor allocation returned no value")
            self._session.add(
                SyncEventModel(
                    user_id=event.user_id,
                    cursor=cursor,
                    event_id=event.event_id,
                    event_type=event.event_type.value,
                    conversation_id=event.conversation_id,
                    message_id=event.message_id,
                    actor_user_id=event.actor_user_id,
                    read_sequence=event.read_sequence,
                    delivery_sequence=event.delivery_sequence,
                    created_at=event.created_at,
                    expires_at=event.expires_at,
                )
            )
        await self._session.flush()

    async def list_after(
        self,
        *,
        user_id: UUID,
        after_cursor: int,
        limit: int,
    ) -> SyncStreamPage:
        stream_cursor = await self._session.scalar(
            select(SyncStreamModel.last_cursor).where(SyncStreamModel.user_id == user_id)
        )
        oldest_cursor = await self._session.scalar(
            select(func.min(SyncEventModel.cursor)).where(SyncEventModel.user_id == user_id)
        )
        models = (
            await self._session.scalars(
                select(SyncEventModel)
                .where(
                    SyncEventModel.user_id == user_id,
                    SyncEventModel.cursor > after_cursor,
                )
                .order_by(SyncEventModel.cursor)
                .limit(limit)
            )
        ).all()
        return SyncStreamPage(
            events=tuple(map_sync_event(model) for model in models),
            stream_cursor=stream_cursor or 0,
            oldest_cursor=oldest_cursor,
        )

    async def prune_expired(self, now: datetime) -> None:
        await self._session.execute(delete(SyncEventModel).where(SyncEventModel.expires_at <= now))


def map_sync_event(model: SyncEventModel) -> SyncEvent:
    return SyncEvent(
        event_id=model.event_id,
        user_id=model.user_id,
        cursor=model.cursor,
        event_type=SyncEventType(model.event_type),
        conversation_id=model.conversation_id,
        message_id=model.message_id,
        actor_user_id=model.actor_user_id,
        read_sequence=model.read_sequence,
        delivery_sequence=model.delivery_sequence,
        created_at=model.created_at,
        expires_at=model.expires_at,
    )
