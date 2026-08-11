"""PostgreSQL-backed password change and security reset transaction behavior."""

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.accounts.bootstrap_admin import BootstrapAdmin, BootstrapAdminCommand
from messenger.application.accounts.change_password import (
    ChangeCurrentPassword,
    ChangeCurrentPasswordCommand,
)
from messenger.application.accounts.security_reset import SecurityReset, SecurityResetCommand
from messenger.application.errors import InvalidCredentialsError
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.login import Login, LoginCommand
from messenger.application.sessions.policy import SessionPolicy
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    ConversationMemberModel,
    ConversationModel,
    DeviceModel,
    SecurityEventModel,
    SessionModel,
    UserModel,
)
from tests.application.fakes import FixedClock

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "new correct horse battery staple"
SESSION_POLICY = SessionPolicy(
    idle_timeout=timedelta(days=30),
    absolute_lifetime=timedelta(days=90),
    rotation_interval=timedelta(days=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def reset_tables(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(ConversationMemberModel))
        await session.execute(delete(ConversationModel))
        await session.execute(delete(SecurityEventModel))
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
        await reset_tables(session_factory)
        user = await BootstrapAdmin(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            passwords=passwords,
        ).execute(
            BootstrapAdminCommand(
                username="alice",
                display_name="Alice",
                password=PASSWORD,
            )
        )
        login = Login(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=1)),
            passwords=passwords,
            credentials=credentials,
            policy=SESSION_POLICY,
            event_policy=EVENT_POLICY,
        )
        first = await login.execute(
            LoginCommand(username="alice", password=PASSWORD, device_name="Laptop")
        )
        current = await login.execute(
            LoginCommand(username="alice", password=PASSWORD, device_name="Phone")
        )

        changed = await ChangeCurrentPassword(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=2)),
            passwords=passwords,
            event_policy=EVENT_POLICY,
        ).execute(
            ChangeCurrentPasswordCommand(
                user_id=user.user_id,
                current_session_id=current.session_id,
                current_password=PASSWORD,
                new_password=NEW_PASSWORD,
            )
        )
        assert changed.revoked_sessions == 1

        with pytest.raises(InvalidCredentialsError):
            await login.execute(
                LoginCommand(username="alice", password=PASSWORD, device_name="Old password")
            )
        new_login = await login.execute(
            LoginCommand(username="alice", password=NEW_PASSWORD, device_name="New login")
        )

        reset = await SecurityReset(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=3)),
            passwords=passwords,
            event_policy=EVENT_POLICY,
        ).execute(
            SecurityResetCommand(
                user_id=user.user_id,
                current_session_id=new_login.session_id,
                current_password=NEW_PASSWORD,
            )
        )
        assert reset.revoked_sessions == 2

        async with session_factory() as session:
            sessions = (await session.scalars(select(SessionModel))).all()
            first_model = await session.get(SessionModel, first.session_id)
            current_model = await session.get(SessionModel, current.session_id)
            new_model = await session.get(SessionModel, new_login.session_id)
            event_types = set(await session.scalars(select(SecurityEventModel.event_type)))
        assert sessions
        assert first_model is not None and first_model.revoked_at is not None
        assert current_model is not None and current_model.revoked_at is not None
        assert new_model is not None and new_model.revoked_at is not None
        assert {"password_changed", "security_reset"}.issubset(event_types)
    finally:
        await reset_tables(session_factory)
        await engine.dispose()


@pytest.mark.integration
async def test_postgresql_current_account_credential_transactions() -> None:
    await run_flow(configured_database_url())
