"""Dishka composition root for application and request-scoped use cases."""

from collections.abc import AsyncIterator

from dishka import AsyncContainer, Provider, Scope, make_async_container, provide
from dishka.integrations.fastapi import FastapiProvider
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.passwords import PasswordHasher
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.application.security_event_policy import SecurityEventPolicy
from messenger.application.session_policy import SessionPolicy
from messenger.application.use_cases.authenticate_session import AuthenticateSession
from messenger.application.use_cases.list_my_sessions import ListMySessions
from messenger.application.use_cases.list_security_events import ListSecurityEvents
from messenger.application.use_cases.login import Login
from messenger.application.use_cases.logout import Logout
from messenger.application.use_cases.rename_my_device import RenameMyDevice
from messenger.application.use_cases.revoke_my_device import RevokeMyDevice
from messenger.application.use_cases.revoke_other_sessions import RevokeOtherSessions
from messenger.bootstrap.settings import AppSettings
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.clock import SystemClock
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import (
    SqlAlchemyIdentityUnitOfWorkFactory,
)


class MessengerProvider(Provider):
    """Declare process resources and request-scoped application operations."""

    def __init__(self, settings: AppSettings) -> None:
        super().__init__()
        self._settings = settings

    @provide(scope=Scope.APP)
    def settings(self) -> AppSettings:
        return self._settings

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
    def clock(self) -> Clock:
        return SystemClock()

    @provide(scope=Scope.APP)
    def passwords(self) -> PasswordHasher:
        return Argon2PasswordHasher()

    @provide(scope=Scope.APP)
    def credentials(self) -> SessionCredentialService:
        return SecureSessionCredentialService()

    @provide(scope=Scope.APP)
    def session_policy(self, settings: AppSettings) -> SessionPolicy:
        return settings.session_policy

    @provide(scope=Scope.APP)
    def security_event_policy(self, settings: AppSettings) -> SecurityEventPolicy:
        return settings.security_event_policy

    login = provide(Login, scope=Scope.REQUEST)
    authenticate_session = provide(AuthenticateSession, scope=Scope.REQUEST)
    logout = provide(Logout, scope=Scope.REQUEST)
    list_my_sessions = provide(ListMySessions, scope=Scope.REQUEST)
    rename_my_device = provide(RenameMyDevice, scope=Scope.REQUEST)
    revoke_my_device = provide(RevokeMyDevice, scope=Scope.REQUEST)
    revoke_other_sessions = provide(RevokeOtherSessions, scope=Scope.REQUEST)
    list_security_events = provide(ListSecurityEvents, scope=Scope.REQUEST)


def create_container(settings: AppSettings) -> AsyncContainer:
    """Create the application container; FastAPI manages REQUEST scopes."""
    return make_async_container(MessengerProvider(settings), FastapiProvider())
