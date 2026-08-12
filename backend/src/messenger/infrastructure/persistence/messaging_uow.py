"""SQLAlchemy transaction boundary for opaque message operations."""

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.ports.attachments import AttachmentRepository
from messenger.application.ports.conversation_crypto import (
    ConversationCryptoGenerationRepository,
    ConversationCryptoRequiredDeviceRepository,
)
from messenger.application.ports.conversations import ConversationRepository
from messenger.application.ports.device_crypto import DeviceCryptoIdentityRepository
from messenger.application.ports.identity import DeviceRepository, UserRepository
from messenger.application.ports.messages import (
    ConversationDeliveryStateRepository,
    ConversationReadStateRepository,
    MessageReactionRepository,
    MessageRepository,
    MessagingUnitOfWork,
)
from messenger.application.ports.sync import SyncRepository
from messenger.infrastructure.persistence.repositories import (
    SqlAlchemyAttachmentRepository,
    SqlAlchemyConversationCryptoGenerationRepository,
    SqlAlchemyConversationCryptoRequiredDeviceRepository,
    SqlAlchemyConversationDeliveryStateRepository,
    SqlAlchemyConversationReadStateRepository,
    SqlAlchemyConversationRepository,
    SqlAlchemyDeviceCryptoIdentityRepository,
    SqlAlchemyDeviceRepository,
    SqlAlchemyMessageReactionRepository,
    SqlAlchemyMessageRepository,
    SqlAlchemySyncRepository,
    SqlAlchemyUserRepository,
)


class SqlAlchemyMessagingUnitOfWork:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.messages: MessageRepository
        self.delivery_states: ConversationDeliveryStateRepository
        self.read_states: ConversationReadStateRepository
        self.conversations: ConversationRepository
        self.users: UserRepository
        self.devices: DeviceRepository
        self.sync_events: SyncRepository
        self.crypto_generations: ConversationCryptoGenerationRepository
        self.crypto_required_devices: ConversationCryptoRequiredDeviceRepository
        self.crypto_identities: DeviceCryptoIdentityRepository
        self.attachments: AttachmentRepository
        self.reactions: MessageReactionRepository

    async def __aenter__(self) -> "SqlAlchemyMessagingUnitOfWork":
        self._session = self._session_factory()
        self.messages = SqlAlchemyMessageRepository(self._session)
        self.delivery_states = SqlAlchemyConversationDeliveryStateRepository(self._session)
        self.read_states = SqlAlchemyConversationReadStateRepository(self._session)
        self.conversations = SqlAlchemyConversationRepository(self._session)
        self.users = SqlAlchemyUserRepository(self._session)
        self.devices = SqlAlchemyDeviceRepository(self._session)
        self.sync_events = SqlAlchemySyncRepository(self._session)
        self.crypto_generations = SqlAlchemyConversationCryptoGenerationRepository(self._session)
        self.crypto_required_devices = SqlAlchemyConversationCryptoRequiredDeviceRepository(
            self._session
        )
        self.crypto_identities = SqlAlchemyDeviceCryptoIdentityRepository(self._session)
        self.attachments = SqlAlchemyAttachmentRepository(self._session)
        self.reactions = SqlAlchemyMessageReactionRepository(self._session)
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


class SqlAlchemyMessagingUnitOfWorkFactory:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    def __call__(self) -> MessagingUnitOfWork:
        return SqlAlchemyMessagingUnitOfWork(self._session_factory)
