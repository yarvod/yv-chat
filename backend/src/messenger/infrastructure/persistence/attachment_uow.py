"""SQLAlchemy transaction boundary for group attachment operations."""

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.ports.attachments import (
    AttachmentRepository,
    AttachmentUnitOfWork,
)
from messenger.application.ports.conversations import ConversationRepository
from messenger.application.ports.identity import DeviceRepository, UserRepository
from messenger.application.ports.messages.repository import MessageRepository
from messenger.infrastructure.persistence.repositories import (
    SqlAlchemyAttachmentRepository,
    SqlAlchemyConversationRepository,
    SqlAlchemyDeviceRepository,
    SqlAlchemyMessageRepository,
    SqlAlchemyUserRepository,
)


class SqlAlchemyAttachmentUnitOfWork:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.attachments: AttachmentRepository
        self.conversations: ConversationRepository
        self.users: UserRepository
        self.devices: DeviceRepository
        self.messages: MessageRepository

    async def __aenter__(self) -> "SqlAlchemyAttachmentUnitOfWork":
        self._session = self._session_factory()
        self.attachments = SqlAlchemyAttachmentRepository(self._session)
        self.conversations = SqlAlchemyConversationRepository(self._session)
        self.users = SqlAlchemyUserRepository(self._session)
        self.devices = SqlAlchemyDeviceRepository(self._session)
        self.messages = SqlAlchemyMessageRepository(self._session)
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


class SqlAlchemyAttachmentUnitOfWorkFactory:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    def __call__(self) -> AttachmentUnitOfWork:
        return SqlAlchemyAttachmentUnitOfWork(self._session_factory)
