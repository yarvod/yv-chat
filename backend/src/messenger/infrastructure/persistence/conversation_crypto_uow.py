"""SQLAlchemy transaction boundary for MLS conversation coordination."""

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.ports.conversation_crypto import (
    ConversationCryptoGenerationRepository,
    ConversationCryptoRequiredDeviceRepository,
    ConversationCryptoUnitOfWork,
    ConversationCryptoWelcomeRepository,
)
from messenger.application.ports.conversations import ConversationRepository
from messenger.application.ports.device_crypto import (
    DeviceCryptoIdentityRepository,
    DeviceKeyPackageRepository,
)
from messenger.application.ports.identity import DeviceRepository
from messenger.infrastructure.persistence.repositories import (
    SqlAlchemyConversationCryptoGenerationRepository,
    SqlAlchemyConversationCryptoRequiredDeviceRepository,
    SqlAlchemyConversationCryptoWelcomeRepository,
    SqlAlchemyConversationRepository,
    SqlAlchemyDeviceCryptoIdentityRepository,
    SqlAlchemyDeviceKeyPackageRepository,
    SqlAlchemyDeviceRepository,
)


class SqlAlchemyConversationCryptoUnitOfWork:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.conversations: ConversationRepository
        self.devices: DeviceRepository
        self.identities: DeviceCryptoIdentityRepository
        self.key_packages: DeviceKeyPackageRepository
        self.generations: ConversationCryptoGenerationRepository
        self.required_devices: ConversationCryptoRequiredDeviceRepository
        self.welcomes: ConversationCryptoWelcomeRepository

    async def __aenter__(self) -> "SqlAlchemyConversationCryptoUnitOfWork":
        session = self._session_factory()
        self._session = session
        self.conversations = SqlAlchemyConversationRepository(session)
        self.devices = SqlAlchemyDeviceRepository(session)
        self.identities = SqlAlchemyDeviceCryptoIdentityRepository(session)
        self.key_packages = SqlAlchemyDeviceKeyPackageRepository(session)
        self.generations = SqlAlchemyConversationCryptoGenerationRepository(session)
        self.required_devices = SqlAlchemyConversationCryptoRequiredDeviceRepository(session)
        self.welcomes = SqlAlchemyConversationCryptoWelcomeRepository(session)
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


class SqlAlchemyConversationCryptoUnitOfWorkFactory:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    def __call__(self) -> ConversationCryptoUnitOfWork:
        return SqlAlchemyConversationCryptoUnitOfWork(self._session_factory)
