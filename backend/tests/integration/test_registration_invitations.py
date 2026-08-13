"""PostgreSQL concurrency for standalone registration redemption."""

import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from messenger.application.accounts.bootstrap_admin import BootstrapAdmin, BootstrapAdminCommand
from messenger.application.accounts.create_registration_invitation import (
    CreateRegistrationInvitation,
    CreateRegistrationInvitationCommand,
)
from messenger.application.accounts.register_with_invitation import (
    RegisterWithInvitation,
    RegisterWithInvitationCommand,
    RegisterWithInvitationResult,
)
from messenger.application.errors import InvalidRegistrationInvitationError
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.policy import SessionPolicy
from messenger.infrastructure.auth.activation_secrets import SecureActivationSecretService
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork
from messenger.infrastructure.persistence.models import (
    RegistrationInvitationModel,
    SessionModel,
    UserModel,
)
from tests.application.fakes import FixedClock
from tests.integration.test_account_activation import (
    NOW,
    PASSWORD,
    configured_database_url,
    reset_identity_tables,
)

POLICY = SessionPolicy(
    idle_timeout=timedelta(days=30),
    absolute_lifetime=timedelta(days=90),
    rotation_interval=timedelta(days=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)


@pytest.mark.integration
async def test_concurrent_redemption_creates_exactly_one_user_and_session() -> None:
    engine = create_engine(configured_database_url())
    session_factory = create_session_factory(engine)

    def unit_of_work() -> IdentityUnitOfWork:
        return SqlAlchemyIdentityUnitOfWork(session_factory)

    try:
        await reset_identity_tables(session_factory)
        passwords = Argon2PasswordHasher()
        admin = await BootstrapAdmin(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            passwords=passwords,
        ).execute(
            BootstrapAdminCommand(
                username="admin",
                display_name="Admin",
                password=PASSWORD,
            )
        )
        secrets = SecureActivationSecretService()
        invitation = await CreateRegistrationInvitation(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            secrets=secrets,
            activation_ttl=timedelta(hours=24),
        ).execute(CreateRegistrationInvitationCommand(actor_user_id=admin.user_id))
        register = RegisterWithInvitation(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW + timedelta(minutes=1)),
            secrets=secrets,
            passwords=passwords,
            credentials=SecureSessionCredentialService(),
            policy=POLICY,
            event_policy=SecurityEventPolicy(retention=timedelta(days=90)),
        )

        async def redeem() -> RegisterWithInvitationResult | Exception:
            try:
                return await register.execute(
                    RegisterWithInvitationCommand(
                        activation_secret=invitation.activation_secret,
                        username="alice",
                        display_name="Alice",
                        password=PASSWORD,
                        device_name="Phone",
                    )
                )
            except Exception as error:
                return error

        outcomes = await asyncio.gather(redeem(), redeem())
        assert sum(isinstance(item, RegisterWithInvitationResult) for item in outcomes) == 1
        assert sum(isinstance(item, InvalidRegistrationInvitationError) for item in outcomes) == 1

        async with session_factory() as session:
            assert await session.scalar(select(func.count(UserModel.id))) == 2
            assert await session.scalar(select(func.count(SessionModel.id))) == 1
            stored = await session.get(RegistrationInvitationModel, invitation.invitation_id)
            assert stored is not None
            assert stored.used_at == NOW + timedelta(minutes=1)
            assert stored.registered_user_id is not None
    finally:
        await reset_identity_tables(session_factory)
        await engine.dispose()
