"""SQLAlchemy transaction boundary for sync reads and retention cleanup."""

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.ports.identity import UserRepository
from messenger.application.ports.sync import SyncRepository, SyncUnitOfWork
from messenger.infrastructure.persistence.repositories import (
    SqlAlchemySyncRepository,
    SqlAlchemyUserRepository,
)


class SqlAlchemySyncUnitOfWork:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.users: UserRepository
        self.sync_events: SyncRepository

    async def __aenter__(self) -> "SqlAlchemySyncUnitOfWork":
        self._session = self._session_factory()
        self.users = SqlAlchemyUserRepository(self._session)
        self.sync_events = SqlAlchemySyncRepository(self._session)
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


class SqlAlchemySyncUnitOfWorkFactory:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    def __call__(self) -> SyncUnitOfWork:
        return SqlAlchemySyncUnitOfWork(self._session_factory)
