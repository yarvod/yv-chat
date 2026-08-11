"""SQLAlchemy device repository adapter."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import Device
from messenger.infrastructure.persistence.models import DeviceModel
from messenger.infrastructure.persistence.repositories.mappers import map_device


class SqlAlchemyDeviceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, device_id: UUID, *, for_update: bool = False) -> Device | None:
        statement = select(DeviceModel).where(DeviceModel.id == device_id)
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_device(model) if model is not None else None

    async def get_owned_by_id(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
        for_update: bool = False,
    ) -> Device | None:
        statement = select(DeviceModel).where(
            DeviceModel.id == device_id,
            DeviceModel.user_id == user_id,
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_device(model) if model is not None else None

    async def add(self, device: Device) -> None:
        self._session.add(
            DeviceModel(
                id=device.id,
                user_id=device.user_id,
                name=device.name,
                created_at=device.created_at,
                last_seen_at=device.last_seen_at,
                revoked_at=device.revoked_at,
                login_ip=device.login_ip,
                last_ip=device.last_ip,
            )
        )
        await self._session.flush()

    async def update(self, device: Device) -> None:
        model = await self._session.get(DeviceModel, device.id)
        if model is None:
            raise RuntimeError("locked device disappeared during update")
        model.name = device.name
        model.last_seen_at = device.last_seen_at
        model.revoked_at = device.revoked_at
        model.last_ip = device.last_ip
        await self._session.flush()
