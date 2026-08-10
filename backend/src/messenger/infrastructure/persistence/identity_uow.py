"""SQLAlchemy transaction boundary for identity operations."""

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.ports.identity import (
    ActivationTokenRepository,
    DeviceRepository,
    SessionRepository,
    UserRepository,
)
from messenger.infrastructure.persistence.identity_repositories import (
    SqlAlchemyActivationTokenRepository,
    SqlAlchemyDeviceRepository,
    SqlAlchemySessionRepository,
    SqlAlchemyUserRepository,
)


class SqlAlchemyIdentityUnitOfWork:
    """Own one async session and transaction per use-case execution."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.users: UserRepository
        self.activation_tokens: ActivationTokenRepository
        self.devices: DeviceRepository
        self.sessions: SessionRepository

    async def __aenter__(self) -> "SqlAlchemyIdentityUnitOfWork":
        self._session = self._session_factory()
        self.users = SqlAlchemyUserRepository(self._session)
        self.activation_tokens = SqlAlchemyActivationTokenRepository(self._session)
        self.devices = SqlAlchemyDeviceRepository(self._session)
        self.sessions = SqlAlchemySessionRepository(self._session)
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
