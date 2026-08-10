"""PostgreSQL-backed invitation and concurrent activation flow."""

import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.errors import (
    ActivationAlreadyUsedError,
    BootstrapAlreadyCompletedError,
    DuplicateUsernameError,
)
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.use_cases.activate_account import (
    ActivateAccount,
    ActivateAccountCommand,
    ActivateAccountResult,
)
from messenger.application.use_cases.bootstrap_admin import (
    BootstrapAdmin,
    BootstrapAdminCommand,
    BootstrapAdminResult,
)
from messenger.application.use_cases.create_user_invitation import (
    CreateUserInvitation,
    CreateUserInvitationCommand,
)
from messenger.infrastructure.auth.activation_secrets import SecureActivationSecretService
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    DeviceModel,
    SecurityEventModel,
    SessionModel,
    UserModel,
)
from tests.application.fakes import FixedClock

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def reset_identity_tables(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(SecurityEventModel))
        await session.execute(delete(SessionModel))
        await session.execute(delete(DeviceModel))
        await session.execute(delete(ActivationTokenModel))
        await session.execute(delete(UserModel))


async def run_flow(database_url: str) -> None:
    engine = create_engine(database_url)
    session_factory = create_session_factory(engine)
    secret_service = SecureActivationSecretService()
    password_hasher = Argon2PasswordHasher()

    def unit_of_work() -> IdentityUnitOfWork:
        return SqlAlchemyIdentityUnitOfWork(session_factory)

    try:
        await reset_identity_tables(session_factory)

        bootstrap_admin = BootstrapAdmin(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            passwords=password_hasher,
        )

        async def bootstrap_once(username: str) -> BootstrapAdminResult | Exception:
            try:
                return await bootstrap_admin.execute(
                    BootstrapAdminCommand(
                        username=username,
                        display_name="Administrator",
                        password=PASSWORD,
                    )
                )
            except Exception as error:
                return error

        bootstrap_outcomes = await asyncio.gather(
            bootstrap_once("admin-one"),
            bootstrap_once("admin-two"),
        )
        assert sum(isinstance(outcome, BootstrapAdminResult) for outcome in bootstrap_outcomes) == 1
        assert (
            sum(
                isinstance(outcome, BootstrapAlreadyCompletedError)
                for outcome in bootstrap_outcomes
            )
            == 1
        )
        admin_result = next(
            outcome for outcome in bootstrap_outcomes if isinstance(outcome, BootstrapAdminResult)
        )

        create_invitation = CreateUserInvitation(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            secrets=secret_service,
            activation_ttl=timedelta(hours=24),
        )
        invitation = await create_invitation.execute(
            CreateUserInvitationCommand(
                actor_user_id=admin_result.user_id,
                username="alice",
                display_name="Alice",
            )
        )

        with pytest.raises(DuplicateUsernameError):
            await create_invitation.execute(
                CreateUserInvitationCommand(
                    actor_user_id=admin_result.user_id,
                    username="ALICE",
                    display_name="Duplicate Alice",
                )
            )

        async with session_factory() as session:
            invited_model = await session.get(UserModel, invitation.user_id)
            token_model = await session.scalar(
                select(ActivationTokenModel).where(
                    ActivationTokenModel.user_id == invitation.user_id
                )
            )
            assert invited_model is not None
            assert invited_model.is_active is False
            assert invited_model.password_hash is None
            assert token_model is not None
            assert token_model.token_hash == secret_service.digest(invitation.activation_secret)
            assert invitation.activation_secret not in token_model.token_hash

        activate = ActivateAccount(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=1)),
            secrets=secret_service,
            passwords=password_hasher,
        )

        async def activate_once() -> ActivateAccountResult | Exception:
            try:
                return await activate.execute(
                    ActivateAccountCommand(
                        activation_secret=invitation.activation_secret,
                        password=PASSWORD,
                    )
                )
            except Exception as error:
                return error

        outcomes = await asyncio.gather(activate_once(), activate_once())

        assert sum(isinstance(outcome, ActivateAccountResult) for outcome in outcomes) == 1
        assert sum(isinstance(outcome, ActivationAlreadyUsedError) for outcome in outcomes) == 1

        async with session_factory() as session:
            activated_model = await session.get(UserModel, invitation.user_id)
            consumed_token = await session.scalar(
                select(ActivationTokenModel).where(
                    ActivationTokenModel.user_id == invitation.user_id
                )
            )
            assert activated_model is not None
            assert activated_model.is_active is True
            assert activated_model.password_hash is not None
            assert activated_model.password_hash.startswith("$argon2id$")
            assert PASSWORD not in activated_model.password_hash
            assert await password_hasher.verify(activated_model.password_hash, PASSWORD)
            assert consumed_token is not None
            assert consumed_token.used_at == NOW + timedelta(minutes=1)
    finally:
        await reset_identity_tables(session_factory)
        await engine.dispose()


@pytest.mark.integration
def test_postgresql_invitation_and_concurrent_activation() -> None:
    asyncio.run(run_flow(configured_database_url()))
