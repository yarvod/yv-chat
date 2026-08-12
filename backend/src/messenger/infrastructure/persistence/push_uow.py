"""SQLAlchemy transaction boundary for Web Push operations."""

from __future__ import annotations

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.ports.identity import DeviceRepository
from messenger.application.ports.push import (
    PushSubscriptionRepository,
    PushUnitOfWork,
)
from messenger.infrastructure.persistence.repositories import (
    SqlAlchemyDeviceRepository,
    SqlAlchemyPushSubscriptionRepository,
)


class SqlAlchemyPushUnitOfWork:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None
        self.devices: DeviceRepository
        self.subscriptions: PushSubscriptionRepository

    async def __aenter__(self) -> SqlAlchemyPushUnitOfWork:
        self._session = self._session_factory()
        self.devices = SqlAlchemyDeviceRepository(self._session)
        self.subscriptions = SqlAlchemyPushSubscriptionRepository(self._session)
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


class SqlAlchemyPushUnitOfWorkFactory:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    def __call__(self) -> PushUnitOfWork:
        return SqlAlchemyPushUnitOfWork(self._session_factory)
