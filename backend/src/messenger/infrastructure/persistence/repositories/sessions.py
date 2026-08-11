"""SQLAlchemy opaque-session repository adapter."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.ports.identity import DeviceSessionRecord, SessionCredentialMatch
from messenger.domain.entities import Session
from messenger.infrastructure.persistence.models import DeviceModel, SessionModel
from messenger.infrastructure.persistence.repositories.mappers import map_device, map_session


class SqlAlchemySessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, session: Session) -> None:
        self._session.add(
            SessionModel(
                id=session.id,
                user_id=session.user_id,
                device_id=session.device_id,
                current_token_hash=session.current_token_hash,
                previous_token_hash=session.previous_token_hash,
                previous_token_expires_at=session.previous_token_expires_at,
                created_at=session.created_at,
                last_seen_at=session.last_seen_at,
                idle_expires_at=session.idle_expires_at,
                absolute_expires_at=session.absolute_expires_at,
                rotated_at=session.rotated_at,
                revoked_at=session.revoked_at,
            )
        )
        await self._session.flush()

    async def get_by_token_hash_for_update(
        self,
        token_hash: str,
    ) -> SessionCredentialMatch | None:
        model = await self._session.scalar(
            select(SessionModel)
            .where(
                or_(
                    SessionModel.current_token_hash == token_hash,
                    SessionModel.previous_token_hash == token_hash,
                )
            )
            .with_for_update()
        )
        if model is None:
            return None
        return SessionCredentialMatch(
            session=map_session(model),
            matched_previous=model.previous_token_hash == token_hash,
        )

    async def update(self, session: Session) -> None:
        model = await self._session.get(SessionModel, session.id)
        if model is None:
            raise RuntimeError("locked session disappeared during update")
        model.current_token_hash = session.current_token_hash
        model.previous_token_hash = session.previous_token_hash
        model.previous_token_expires_at = session.previous_token_expires_at
        model.last_seen_at = session.last_seen_at
        model.idle_expires_at = session.idle_expires_at
        model.rotated_at = session.rotated_at
        model.revoked_at = session.revoked_at
        await self._session.flush()

    async def list_active_with_devices(
        self,
        *,
        user_id: UUID,
        now: datetime,
    ) -> list[DeviceSessionRecord]:
        rows = (
            await self._session.execute(
                select(SessionModel, DeviceModel)
                .join(DeviceModel, DeviceModel.id == SessionModel.device_id)
                .where(
                    SessionModel.user_id == user_id,
                    SessionModel.revoked_at.is_(None),
                    SessionModel.idle_expires_at > now,
                    SessionModel.absolute_expires_at > now,
                    DeviceModel.revoked_at.is_(None),
                )
                .order_by(SessionModel.last_seen_at.desc(), SessionModel.id)
            )
        ).all()
        return [
            DeviceSessionRecord(device=map_device(device), session=map_session(session))
            for session, device in rows
        ]

    async def get_by_device_for_user_for_update(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
    ) -> DeviceSessionRecord | None:
        row = (
            await self._session.execute(
                select(SessionModel, DeviceModel)
                .join(DeviceModel, DeviceModel.id == SessionModel.device_id)
                .where(
                    SessionModel.user_id == user_id,
                    SessionModel.device_id == device_id,
                    DeviceModel.user_id == user_id,
                )
                .with_for_update()
            )
        ).one_or_none()
        if row is None:
            return None
        session, device = row
        return DeviceSessionRecord(device=map_device(device), session=map_session(session))

    async def list_for_user_for_update(self, user_id: UUID) -> list[DeviceSessionRecord]:
        rows = (
            await self._session.execute(
                select(SessionModel, DeviceModel)
                .join(DeviceModel, DeviceModel.id == SessionModel.device_id)
                .where(SessionModel.user_id == user_id, DeviceModel.user_id == user_id)
                .order_by(SessionModel.id)
                .with_for_update()
            )
        ).all()
        return [
            DeviceSessionRecord(device=map_device(device), session=map_session(session))
            for session, device in rows
        ]

    async def count_active_for_users(
        self,
        user_ids: set[UUID],
        *,
        now: datetime,
    ) -> dict[UUID, int]:
        if not user_ids:
            return {}
        rows = (
            await self._session.execute(
                select(SessionModel.user_id, func.count(SessionModel.id))
                .join(DeviceModel, DeviceModel.id == SessionModel.device_id)
                .where(
                    SessionModel.user_id.in_(user_ids),
                    SessionModel.revoked_at.is_(None),
                    SessionModel.idle_expires_at > now,
                    SessionModel.absolute_expires_at > now,
                    DeviceModel.revoked_at.is_(None),
                )
                .group_by(SessionModel.user_id)
            )
        ).all()
        return {user_id: int(count) for user_id, count in rows}
