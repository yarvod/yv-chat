"""SQLAlchemy transaction boundary for public device cryptography state."""

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.ports.device_crypto import (
    DeviceCryptoIdentityRepository,
    DeviceCryptoUnitOfWork,
    DeviceKeyPackageRepository,
)
from messenger.application.ports.identity import DeviceRepository
from messenger.infrastructure.persistence.repositories import (
    SqlAlchemyDeviceCryptoIdentityRepository,
    SqlAlchemyDeviceKeyPackageRepository,
    SqlAlchemyDeviceRepository,
)


class SqlAlchemyDeviceCryptoUnitOfWork:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.devices: DeviceRepository
        self.identities: DeviceCryptoIdentityRepository
        self.key_packages: DeviceKeyPackageRepository

    async def __aenter__(self) -> "SqlAlchemyDeviceCryptoUnitOfWork":
        self._session = self._session_factory()
        self.devices = SqlAlchemyDeviceRepository(self._session)
        self.identities = SqlAlchemyDeviceCryptoIdentityRepository(self._session)
        self.key_packages = SqlAlchemyDeviceKeyPackageRepository(self._session)
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if self._session is None:
            return
        if self._session.in_transaction():
            await self._session.rollback()
        await self._session.close()

    async def commit(self) -> None:
        if self._session is None:
            raise RuntimeError("unit of work has not been entered")
        await self._session.commit()


class SqlAlchemyDeviceCryptoUnitOfWorkFactory:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    def __call__(self) -> DeviceCryptoUnitOfWork:
        return SqlAlchemyDeviceCryptoUnitOfWork(self._session_factory)
