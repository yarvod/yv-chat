"""PostgreSQL-backed activation reissue and user deactivation flow."""

import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.accounts.activate import (
    ActivateAccount,
    ActivateAccountCommand,
    ActivateAccountResult,
)
from messenger.application.accounts.bootstrap_admin import BootstrapAdmin, BootstrapAdminCommand
from messenger.application.accounts.invite import (
    CreateUserInvitation,
    CreateUserInvitationCommand,
)
from messenger.application.accounts.issue_password_reset import (
    IssuePasswordReset,
    IssuePasswordResetCommand,
)
from messenger.application.accounts.list_users import ListManagedUsers, ListManagedUsersQuery
from messenger.application.accounts.password_reset_policy import PasswordResetPolicy
from messenger.application.accounts.reissue_activation import (
    ReissueActivation,
    ReissueActivationCommand,
)
from messenger.application.accounts.reset_password import (
    ResetPasswordWithToken,
    ResetPasswordWithTokenCommand,
    ResetPasswordWithTokenResult,
)
from messenger.application.accounts.update_user import (
    UpdateManagedUser,
    UpdateManagedUserCommand,
)
from messenger.application.errors import (
    ActivationAlreadyUsedError,
    AuthorizationDeniedError,
    InvalidActivationSecretError,
    InvalidCredentialsError,
    InvalidPasswordResetSecretError,
)
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.login import Login, LoginCommand
from messenger.application.sessions.policy import SessionPolicy
from messenger.infrastructure.auth.activation_secrets import SecureActivationSecretService
from messenger.infrastructure.auth.password_reset_secrets import (
    SecurePasswordResetSecretService,
)
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    ConversationMemberModel,
    ConversationModel,
    DeviceModel,
    MessageModel,
    PasswordResetTokenModel,
    SecurityEventModel,
    SessionModel,
    SyncEventModel,
    SyncStreamModel,
    UserModel,
)
from tests.application.fakes import FixedClock

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"
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


async def reset_identity_tables(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(SyncEventModel))
        await session.execute(delete(SyncStreamModel))
        await session.execute(delete(MessageModel))
        await session.execute(delete(ConversationMemberModel))
        await session.execute(delete(ConversationModel))
        await session.execute(delete(SecurityEventModel))
        await session.execute(delete(SessionModel))
        await session.execute(delete(DeviceModel))
        await session.execute(delete(PasswordResetTokenModel))
        await session.execute(delete(ActivationTokenModel))
        await session.execute(delete(UserModel))


async def run_flow(database_url: str) -> None:
    engine = create_engine(database_url)
    session_factory = create_session_factory(engine)
    passwords = Argon2PasswordHasher()
    activation_secrets = SecureActivationSecretService()
    session_credentials = SecureSessionCredentialService()
    password_reset_secrets = SecurePasswordResetSecretService()

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
        invitation = await CreateUserInvitation(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            secrets=activation_secrets,
            activation_ttl=timedelta(days=1),
        ).execute(
            CreateUserInvitationCommand(
                actor_user_id=admin.user_id,
                username="alice",
                display_name="Alice",
            )
        )
        reissued = await ReissueActivation(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=1)),
            secrets=activation_secrets,
            activation_ttl=timedelta(days=1),
        ).execute(
            ReissueActivationCommand(
                actor_user_id=admin.user_id,
                target_user_id=invitation.user_id,
            )
        )
        activate = ActivateAccount(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=2)),
            secrets=activation_secrets,
            passwords=passwords,
        )

        with pytest.raises(InvalidActivationSecretError):
            await activate.execute(
                ActivateAccountCommand(
                    activation_secret=invitation.activation_secret,
                    password=PASSWORD,
                )
            )

        async def activate_once() -> ActivateAccountResult | Exception:
            try:
                return await activate.execute(
                    ActivateAccountCommand(
                        activation_secret=reissued.activation_secret,
                        password=PASSWORD,
                    )
                )
            except Exception as error:
                return error

        activation_outcomes = await asyncio.gather(activate_once(), activate_once())
        assert sum(isinstance(item, ActivateAccountResult) for item in activation_outcomes) == 1
        assert (
            sum(isinstance(item, ActivationAlreadyUsedError) for item in activation_outcomes) == 1
        )

        login = Login(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=3)),
            passwords=passwords,
            credentials=session_credentials,
            policy=SESSION_POLICY,
            event_policy=EVENT_POLICY,
        )
        first_session = await login.execute(
            LoginCommand(username="alice", password=PASSWORD, device_name="Laptop")
        )
        second_session = await login.execute(
            LoginCommand(username="alice", password=PASSWORD, device_name="Phone")
        )
        admin_session = await login.execute(
            LoginCommand(username="admin", password=PASSWORD, device_name="Admin laptop")
        )

        update = UpdateManagedUser(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=4)),
        )
        deactivated = await update.execute(
            UpdateManagedUserCommand(
                actor_user_id=admin.user_id,
                target_user_id=invitation.user_id,
                is_active=False,
            )
        )
        assert deactivated.revoked_sessions == 2

        async with session_factory() as session:
            first_model = await session.get(SessionModel, first_session.session_id)
            second_model = await session.get(SessionModel, second_session.session_id)
            admin_model = await session.get(SessionModel, admin_session.session_id)
            assert first_model is not None and first_model.revoked_at is not None
            assert second_model is not None and second_model.revoked_at is not None
            assert admin_model is not None and admin_model.revoked_at is None

        reactivated = await update.execute(
            UpdateManagedUserCommand(
                actor_user_id=admin.user_id,
                target_user_id=invitation.user_id,
                is_active=True,
            )
        )
        assert reactivated.is_active is True

        recovery_session_one = await login.execute(
            LoginCommand(username="alice", password=PASSWORD, device_name="Recovery one")
        )
        recovery_session_two = await login.execute(
            LoginCommand(username="alice", password=PASSWORD, device_name="Recovery two")
        )
        reset_issued = await IssuePasswordReset(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=5)),
            secrets=password_reset_secrets,
            password_reset_policy=PasswordResetPolicy(ttl=timedelta(hours=1)),
            event_policy=EVENT_POLICY,
        ).execute(
            IssuePasswordResetCommand(
                actor_user_id=admin.user_id,
                actor_session_id=admin_session.session_id,
                target_user_id=invitation.user_id,
            )
        )
        assert reset_issued.revoked_sessions == 2

        new_password = "new correct horse battery staple"
        reset_password = ResetPasswordWithToken(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=6)),
            secrets=password_reset_secrets,
            passwords=passwords,
            event_policy=EVENT_POLICY,
        )

        async def reset_once() -> ResetPasswordWithTokenResult | Exception:
            try:
                return await reset_password.execute(
                    ResetPasswordWithTokenCommand(
                        reset_secret=reset_issued.reset_secret,
                        new_password=new_password,
                    )
                )
            except Exception as error:
                return error

        reset_outcomes = await asyncio.gather(reset_once(), reset_once())
        assert sum(isinstance(item, ResetPasswordWithTokenResult) for item in reset_outcomes) == 1
        assert (
            sum(isinstance(item, InvalidPasswordResetSecretError) for item in reset_outcomes) == 1
        )

        with pytest.raises(InvalidCredentialsError):
            await login.execute(
                LoginCommand(username="alice", password=PASSWORD, device_name="Old password")
            )
        recovered = await login.execute(
            LoginCommand(username="alice", password=new_password, device_name="Recovered")
        )
        assert recovered.user_id == invitation.user_id

        async with session_factory() as session:
            first_recovery_model = await session.get(
                SessionModel,
                recovery_session_one.session_id,
            )
            second_recovery_model = await session.get(
                SessionModel,
                recovery_session_two.session_id,
            )
            assert first_recovery_model is not None
            assert first_recovery_model.revoked_at is not None
            assert second_recovery_model is not None
            assert second_recovery_model.revoked_at is not None

        with pytest.raises(AuthorizationDeniedError):
            await ListManagedUsers(
                unit_of_work=unit_of_work,
                clock=FixedClock(NOW + timedelta(minutes=7)),
            ).execute(ListManagedUsersQuery(actor_user_id=invitation.user_id))
    finally:
        await reset_identity_tables(session_factory)
        await engine.dispose()


@pytest.mark.integration
async def test_postgresql_admin_activation_and_session_revocation() -> None:
    await run_flow(configured_database_url())
