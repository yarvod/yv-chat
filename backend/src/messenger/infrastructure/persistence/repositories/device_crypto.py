"""SQLAlchemy repositories for public device cryptography state."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import DeviceCryptoIdentity, DeviceKeyPackage
from messenger.infrastructure.persistence.models import (
    DeviceCryptoIdentityModel,
    DeviceKeyPackageModel,
)
from messenger.infrastructure.persistence.repositories.mappers import (
    map_device_crypto_identity,
    map_device_key_package,
)


class SqlAlchemyDeviceCryptoIdentityRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_device_id(
        self,
        device_id: UUID,
        *,
        for_update: bool = False,
    ) -> DeviceCryptoIdentity | None:
        statement = select(DeviceCryptoIdentityModel).where(
            DeviceCryptoIdentityModel.device_id == device_id
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_device_crypto_identity(model) if model is not None else None

    async def add(self, identity: DeviceCryptoIdentity) -> None:
        self._session.add(
            DeviceCryptoIdentityModel(
                device_id=identity.device_id,
                user_id=identity.user_id,
                protocol_version=identity.protocol_version,
                credential_identity=identity.credential_identity,
                signature_public_key=identity.signature_public_key,
                fingerprint=identity.fingerprint,
                created_at=identity.created_at,
            )
        )
        await self._session.flush()


class SqlAlchemyDeviceKeyPackageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_initial_by_device_id(
        self,
        device_id: UUID,
    ) -> DeviceKeyPackage | None:
        statement = (
            select(DeviceKeyPackageModel)
            .where(DeviceKeyPackageModel.device_id == device_id)
            .order_by(DeviceKeyPackageModel.created_at, DeviceKeyPackageModel.id)
            .limit(1)
        )
        model = await self._session.scalar(statement)
        return map_device_key_package(model) if model is not None else None

    async def add(self, key_package: DeviceKeyPackage) -> None:
        self._session.add(
            DeviceKeyPackageModel(
                id=key_package.id,
                device_id=key_package.device_id,
                user_id=key_package.user_id,
                package_ref=key_package.package_ref,
                key_package=key_package.key_package,
                created_at=key_package.created_at,
            )
        )
        await self._session.flush()
