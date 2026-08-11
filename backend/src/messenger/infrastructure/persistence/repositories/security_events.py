"""SQLAlchemy bounded security-event repository adapter."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import SecurityEvent
from messenger.infrastructure.persistence.models import SecurityEventModel
from messenger.infrastructure.persistence.repositories.mappers import map_security_event


class SqlAlchemySecurityEventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, event: SecurityEvent) -> None:
        self._session.add(
            SecurityEventModel(
                id=event.id,
                user_id=event.user_id,
                event_type=event.event_type.value,
                created_at=event.created_at,
                expires_at=event.expires_at,
                actor_session_id=event.actor_session_id,
                target_device_id=event.target_device_id,
            )
        )
        await self._session.flush()

    async def list_recent(
        self,
        *,
        user_id: UUID,
        now: datetime,
        limit: int,
    ) -> list[SecurityEvent]:
        models = (
            await self._session.scalars(
                select(SecurityEventModel)
                .where(
                    SecurityEventModel.user_id == user_id,
                    SecurityEventModel.expires_at > now,
                )
                .order_by(SecurityEventModel.created_at.desc(), SecurityEventModel.id.desc())
                .limit(limit)
            )
        ).all()
        return [map_security_event(model) for model in models]

    async def prune_expired(self, now: datetime) -> None:
        await self._session.execute(
            delete(SecurityEventModel).where(SecurityEventModel.expires_at <= now)
        )
