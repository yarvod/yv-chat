"""Database lifecycle and identity Unit of Work bindings."""

from collections.abc import AsyncIterator

from dishka import Provider, Scope, provide
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from messenger.application.ports.conversations import ConversationUnitOfWorkFactory
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.sync import SyncUnitOfWorkFactory
from messenger.bootstrap.settings import AppSettings
from messenger.infrastructure.persistence.conversation_uow import (
    SqlAlchemyConversationUnitOfWorkFactory,
)
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWorkFactory
from messenger.infrastructure.persistence.messaging_uow import (
    SqlAlchemyMessagingUnitOfWorkFactory,
)
from messenger.infrastructure.persistence.sync_uow import SqlAlchemySyncUnitOfWorkFactory


class PersistenceProvider(Provider):
    """Own process database resources without leaking ORM into application."""

    @provide(scope=Scope.APP)
    async def engine(self, settings: AppSettings) -> AsyncIterator[AsyncEngine]:
        engine = create_engine(settings.database_url)
        try:
            yield engine
        finally:
            await engine.dispose()

    @provide(scope=Scope.APP)
    def session_factory(
        self,
        engine: AsyncEngine,
    ) -> async_sessionmaker[AsyncSession]:
        return create_session_factory(engine)

    @provide(scope=Scope.APP)
    def unit_of_work_factory(
        self,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> IdentityUnitOfWorkFactory:
        return SqlAlchemyIdentityUnitOfWorkFactory(session_factory)

    @provide(scope=Scope.APP)
    def conversation_unit_of_work_factory(
        self,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> ConversationUnitOfWorkFactory:
        return SqlAlchemyConversationUnitOfWorkFactory(session_factory)

    @provide(scope=Scope.APP)
    def messaging_unit_of_work_factory(
        self,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> MessagingUnitOfWorkFactory:
        return SqlAlchemyMessagingUnitOfWorkFactory(session_factory)

    @provide(scope=Scope.APP)
    def sync_unit_of_work_factory(
        self,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> SyncUnitOfWorkFactory:
        return SqlAlchemySyncUnitOfWorkFactory(session_factory)
