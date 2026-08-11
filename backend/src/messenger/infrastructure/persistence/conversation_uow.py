"""SQLAlchemy transaction boundary for conversation operations."""

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.ports.conversations import (
    ConversationRepository,
    ConversationUnitOfWork,
)
from messenger.application.ports.identity import UserRepository
from messenger.infrastructure.persistence.repositories import (
    SqlAlchemyConversationRepository,
    SqlAlchemyUserRepository,
)


class SqlAlchemyConversationUnitOfWork:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.conversations: ConversationRepository
        self.users: UserRepository

    async def __aenter__(self) -> "SqlAlchemyConversationUnitOfWork":
        self._session = self._session_factory()
        self.conversations = SqlAlchemyConversationRepository(self._session)
        self.users = SqlAlchemyUserRepository(self._session)
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


class SqlAlchemyConversationUnitOfWorkFactory:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    def __call__(self) -> ConversationUnitOfWork:
        return SqlAlchemyConversationUnitOfWork(self._session_factory)
