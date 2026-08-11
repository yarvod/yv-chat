"""SQLAlchemy repositories for public device cryptography state."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.errors import DeviceKeyPackageConflictError
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

    async def get_by_device_ids(
        self,
        device_ids: set[UUID],
    ) -> list[DeviceCryptoIdentity]:
        if not device_ids:
            return []
        models = await self._session.scalars(
            select(DeviceCryptoIdentityModel).where(
                DeviceCryptoIdentityModel.device_id.in_(device_ids)
            )
        )
        return [map_device_crypto_identity(model) for model in models]


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
        self._session.add(self._model(key_package))
        await self._flush_key_packages()

    async def add_many(self, key_packages: tuple[DeviceKeyPackage, ...]) -> None:
        self._session.add_all([self._model(key_package) for key_package in key_packages])
        await self._flush_key_packages()

    async def get_by_refs(self, package_refs: set[str]) -> list[DeviceKeyPackage]:
        if not package_refs:
            return []
        models = await self._session.scalars(
            select(DeviceKeyPackageModel).where(DeviceKeyPackageModel.package_ref.in_(package_refs))
        )
        return [map_device_key_package(model) for model in models]

    async def get_by_ids(self, package_ids: set[UUID]) -> list[DeviceKeyPackage]:
        if not package_ids:
            return []
        models = await self._session.scalars(
            select(DeviceKeyPackageModel).where(DeviceKeyPackageModel.id.in_(package_ids))
        )
        return [map_device_key_package(model) for model in models]

    async def count_available(self, device_id: UUID) -> int:
        count = await self._session.scalar(
            select(func.count(DeviceKeyPackageModel.id)).where(
                DeviceKeyPackageModel.device_id == device_id,
                DeviceKeyPackageModel.claimed_at.is_(None),
            )
        )
        return int(count or 0)

    async def get_by_claim_request(
        self,
        *,
        claiming_device_id: UUID,
        request_id: UUID,
        for_update: bool = False,
    ) -> DeviceKeyPackage | None:
        statement = select(DeviceKeyPackageModel).where(
            DeviceKeyPackageModel.claimed_by_device_id == claiming_device_id,
            DeviceKeyPackageModel.claim_request_id == request_id,
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_device_key_package(model) if model is not None else None

    async def get_next_available_for_update(
        self,
        device_id: UUID,
    ) -> DeviceKeyPackage | None:
        model = await self._session.scalar(
            select(DeviceKeyPackageModel)
            .where(
                DeviceKeyPackageModel.device_id == device_id,
                DeviceKeyPackageModel.claimed_at.is_(None),
            )
            .order_by(DeviceKeyPackageModel.created_at, DeviceKeyPackageModel.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        return map_device_key_package(model) if model is not None else None

    async def update(self, key_package: DeviceKeyPackage) -> None:
        model = await self._session.get(DeviceKeyPackageModel, key_package.id)
        if model is None:
            raise RuntimeError("device KeyPackage disappeared during transaction")
        model.claimed_at = key_package.claimed_at
        model.claimed_by_user_id = key_package.claimed_by_user_id
        model.claimed_by_device_id = key_package.claimed_by_device_id
        model.claim_conversation_id = key_package.claim_conversation_id
        model.claim_request_id = key_package.claim_request_id
        await self._session.flush()

    @staticmethod
    def _model(key_package: DeviceKeyPackage) -> DeviceKeyPackageModel:
        return DeviceKeyPackageModel(
            id=key_package.id,
            device_id=key_package.device_id,
            user_id=key_package.user_id,
            package_ref=key_package.package_ref,
            key_package=key_package.key_package,
            created_at=key_package.created_at,
            claimed_at=key_package.claimed_at,
            claimed_by_user_id=key_package.claimed_by_user_id,
            claimed_by_device_id=key_package.claimed_by_device_id,
            claim_conversation_id=key_package.claim_conversation_id,
            claim_request_id=key_package.claim_request_id,
        )

    async def _flush_key_packages(self) -> None:
        try:
            await self._session.flush()
        except IntegrityError as error:
            constraint = getattr(getattr(error.orig, "__cause__", None), "constraint_name", None)
            if constraint in {
                "uq_device_key_package_ref",
                "uq_device_key_package_claim_request",
            }:
                raise DeviceKeyPackageConflictError(
                    "KeyPackage conflicts with durable state"
                ) from error
            raise
