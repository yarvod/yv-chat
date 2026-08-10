"""Explicit composition root for authentication application services."""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncEngine

from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.use_cases.authenticate_session import AuthenticateSession
from messenger.application.use_cases.login import Login
from messenger.application.use_cases.logout import Logout
from messenger.bootstrap.settings import AppSettings
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.clock import SystemClock
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork


@dataclass(frozen=True, slots=True)
class AuthServices:
    """Concrete use cases required by the HTTP authentication router."""

    login: Login
    authenticate_session: AuthenticateSession
    logout: Logout


@dataclass(frozen=True, slots=True)
class ApplicationContainer:
    """Process-owned resources and application services."""

    auth: AuthServices
    engine: AsyncEngine

    async def close(self) -> None:
        await self.engine.dispose()


def build_container(settings: AppSettings) -> ApplicationContainer:
    """Wire infrastructure adapters into application use cases."""
    engine = create_engine(settings.database_url)
    session_factory = create_session_factory(engine)

    def unit_of_work() -> IdentityUnitOfWork:
        return SqlAlchemyIdentityUnitOfWork(session_factory)

    clock = SystemClock()
    credentials = SecureSessionCredentialService()
    auth = AuthServices(
        login=Login(
            unit_of_work=unit_of_work,
            clock=clock,
            passwords=Argon2PasswordHasher(),
            credentials=credentials,
            policy=settings.session_policy,
        ),
        authenticate_session=AuthenticateSession(
            unit_of_work=unit_of_work,
            clock=clock,
            credentials=credentials,
            policy=settings.session_policy,
        ),
        logout=Logout(
            unit_of_work=unit_of_work,
            clock=clock,
            credentials=credentials,
        ),
    )
    return ApplicationContainer(auth=auth, engine=engine)
