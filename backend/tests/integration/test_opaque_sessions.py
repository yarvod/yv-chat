"""PostgreSQL-backed opaque session concurrency and replay flow."""

import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.errors import (
    SessionCredentialReplayError,
    SessionNotAuthenticatedError,
)
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.session_policy import SessionPolicy
from messenger.application.use_cases.authenticate_session import (
    AuthenticateSession,
    AuthenticateSessionCommand,
    AuthenticateSessionResult,
)
from messenger.application.use_cases.bootstrap_admin import (
    BootstrapAdmin,
    BootstrapAdminCommand,
)
from messenger.application.use_cases.login import Login, LoginCommand
from messenger.application.use_cases.logout import Logout, LogoutCommand
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    DeviceModel,
    SessionModel,
    UserModel,
)
from tests.application.fakes import FixedClock

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"
POLICY = SessionPolicy(
    idle_timeout=timedelta(days=30),
    absolute_lifetime=timedelta(days=90),
    rotation_interval=timedelta(days=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def reset_identity_tables(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(SessionModel))
        await session.execute(delete(DeviceModel))
        await session.execute(delete(ActivationTokenModel))
        await session.execute(delete(UserModel))


async def run_flow(database_url: str) -> None:
    engine = create_engine(database_url)
    session_factory = create_session_factory(engine)
    passwords = Argon2PasswordHasher()
    credentials = SecureSessionCredentialService()

    def unit_of_work() -> IdentityUnitOfWork:
        return SqlAlchemyIdentityUnitOfWork(session_factory)

    try:
        await reset_identity_tables(session_factory)
        admin = await BootstrapAdmin(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            passwords=passwords,
        ).execute(
            BootstrapAdminCommand(
                username="admin",
                display_name="Administrator",
                password=PASSWORD,
            )
        )
        login = await Login(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            passwords=passwords,
            credentials=credentials,
            policy=POLICY,
        ).execute(
            LoginCommand(
                username=admin.username,
                password=PASSWORD,
                device_name="Integration laptop",
                client_ip="192.0.2.10",
            )
        )

        changed_ip = await AuthenticateSession(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=5)),
            credentials=credentials,
            policy=POLICY,
        ).execute(
            AuthenticateSessionCommand(
                session_credential=login.session_credential,
                client_ip="198.51.100.20",
            )
        )
        assert changed_ip.user_id == admin.user_id

        rotate = AuthenticateSession(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(days=1)),
            credentials=credentials,
            policy=POLICY,
        )

        async def authenticate_once() -> AuthenticateSessionResult | Exception:
            try:
                return await rotate.execute(
                    AuthenticateSessionCommand(
                        session_credential=login.session_credential,
                        client_ip="198.51.100.20",
                    )
                )
            except Exception as error:
                return error

        outcomes = await asyncio.gather(authenticate_once(), authenticate_once())

        assert all(isinstance(outcome, AuthenticateSessionResult) for outcome in outcomes)
        rotations = [
            outcome.rotated_session_credential
            for outcome in outcomes
            if isinstance(outcome, AuthenticateSessionResult)
            and outcome.rotated_session_credential is not None
        ]
        assert len(rotations) == 1
        replacement = rotations[0]

        async with session_factory() as session:
            stored_session = await session.scalar(
                select(SessionModel).where(SessionModel.id == login.session_id)
            )
            stored_device = await session.get(DeviceModel, login.device_id)
            assert stored_session is not None
            assert stored_device is not None
            assert stored_session.current_token_hash == credentials.digest(replacement)
            assert stored_session.previous_token_hash == credentials.digest(
                login.session_credential
            )
            assert replacement not in stored_session.current_token_hash
            assert login.session_credential not in stored_session.previous_token_hash
            assert stored_device.last_ip == "198.51.100.20"
            assert stored_session.revoked_at is None

        replay = AuthenticateSession(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(days=1, seconds=60)),
            credentials=credentials,
            policy=POLICY,
        )
        with pytest.raises(SessionCredentialReplayError):
            await replay.execute(
                AuthenticateSessionCommand(session_credential=login.session_credential)
            )
        with pytest.raises(SessionNotAuthenticatedError):
            await replay.execute(AuthenticateSessionCommand(session_credential=replacement))

        second_login = await Login(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(days=2)),
            passwords=passwords,
            credentials=credentials,
            policy=POLICY,
        ).execute(
            LoginCommand(
                username=admin.username,
                password=PASSWORD,
                device_name="Integration phone",
            )
        )
        logout_at = NOW + timedelta(days=2, minutes=1)
        await Logout(
            unit_of_work=unit_of_work,
            clock=FixedClock(logout_at),
            credentials=credentials,
        ).execute(LogoutCommand(session_credential=second_login.session_credential))
        async with session_factory() as session:
            logged_out = await session.get(SessionModel, second_login.session_id)
            assert logged_out is not None
            assert logged_out.revoked_at == logout_at
    finally:
        await reset_identity_tables(session_factory)
        await engine.dispose()


@pytest.mark.integration
def test_postgresql_concurrent_rotation_and_replay_revocation() -> None:
    asyncio.run(run_flow(configured_database_url()))
