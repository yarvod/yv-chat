"""PostgreSQL concurrency contract for immutable device crypto registration."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.device_crypto.register import (
    RegisterDeviceCryptoIdentity,
    RegisterDeviceCryptoIdentityCommand,
)
from messenger.application.ports.device_crypto import DeviceCryptoUnitOfWork
from messenger.application.sync.policy import SyncPolicy
from messenger.domain.entities import Conversation
from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.device_crypto_uow import (
    SqlAlchemyDeviceCryptoUnitOfWork,
)
from messenger.infrastructure.persistence.models import (
    ConversationMemberModel,
    ConversationModel,
    DeviceCryptoIdentityModel,
    DeviceKeyPackageModel,
    DeviceModel,
    SyncEventModel,
    SyncStreamModel,
    UserModel,
)
from messenger.infrastructure.persistence.repositories import SqlAlchemyConversationRepository
from tests.application.fakes import FixedClock

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("1b0a32e8-144f-4f60-bcb6-112f71bd5316")
DEVICE_ID = UUID("50d6b08a-84ae-4bd7-829a-f40f38e9a2c1")
OTHER_USER_ID = UUID("ce1ecf72-b414-4e65-901f-18ebc7fe3cee")
CONVERSATION_ID = UUID("d959239f-8a90-45b6-ae27-e8216cea1681")
SYNC_POLICY = SyncPolicy(retention=timedelta(days=30))


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def reset_tables(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(SyncEventModel))
        await session.execute(delete(SyncStreamModel))
        await session.execute(delete(DeviceKeyPackageModel))
        await session.execute(delete(DeviceCryptoIdentityModel))
        await session.execute(delete(ConversationMemberModel))
        await session.execute(delete(ConversationModel))
        await session.execute(delete(DeviceModel))
        await session.execute(delete(UserModel))


@pytest.mark.integration
async def test_concurrent_exact_registration_creates_one_identity_and_package() -> None:
    engine = create_engine(configured_database_url())
    session_factory = create_session_factory(engine)

    def unit_of_work() -> DeviceCryptoUnitOfWork:
        return SqlAlchemyDeviceCryptoUnitOfWork(session_factory)

    try:
        await reset_tables(session_factory)
        async with session_factory.begin() as session:
            session.add(
                UserModel(
                    id=USER_ID,
                    username="crypto-user",
                    display_name="Crypto User",
                    password_hash=None,
                    is_admin=False,
                    is_active=True,
                    created_at=NOW,
                    updated_at=NOW,
                )
            )
            await session.flush()
            session.add(
                DeviceModel(
                    id=DEVICE_ID,
                    user_id=USER_ID,
                    name="Browser",
                    created_at=NOW,
                    last_seen_at=NOW,
                    revoked_at=None,
                    login_ip=None,
                    last_ip=None,
                )
            )

        command = RegisterDeviceCryptoIdentityCommand(
            user_id=USER_ID,
            device_id=DEVICE_ID,
            credential_identity=expected_credential_identity(USER_ID, DEVICE_ID),
            signature_public_key=bytes(range(32)),
            key_package=b"opaque-public-key-package",
        )
        first, second = await asyncio.gather(
            RegisterDeviceCryptoIdentity(
                unit_of_work=unit_of_work,
                clock=FixedClock(NOW),
                sync_policy=SYNC_POLICY,
            ).execute(command),
            RegisterDeviceCryptoIdentity(
                unit_of_work=unit_of_work,
                clock=FixedClock(NOW),
                sync_policy=SYNC_POLICY,
            ).execute(command),
        )
        assert first == second

        async with session_factory() as session:
            identity_count = await session.scalar(
                select(func.count()).select_from(DeviceCryptoIdentityModel)
            )
            package_count = await session.scalar(
                select(func.count()).select_from(DeviceKeyPackageModel)
            )
        assert identity_count == 1
        assert package_count == 1
    finally:
        await reset_tables(session_factory)
        await engine.dispose()


@pytest.mark.integration
async def test_identity_registration_persists_roster_events_across_engine_restart() -> None:
    database_url = configured_database_url()
    first_engine = create_engine(database_url)
    first_sessions = create_session_factory(first_engine)
    command = RegisterDeviceCryptoIdentityCommand(
        user_id=USER_ID,
        device_id=DEVICE_ID,
        credential_identity=expected_credential_identity(USER_ID, DEVICE_ID),
        signature_public_key=bytes(range(32)),
        key_package=b"opaque-public-key-package",
    )
    try:
        await reset_tables(first_sessions)
        conversation = Conversation.create_direct(
            created_by=USER_ID,
            other_user_id=OTHER_USER_ID,
            now=NOW,
            conversation_id=CONVERSATION_ID,
        )
        async with first_sessions.begin() as session:
            session.add_all(
                [
                    UserModel(
                        id=user_id,
                        username=username,
                        display_name=username.title(),
                        password_hash=None,
                        is_admin=False,
                        is_active=True,
                        created_at=NOW,
                        updated_at=NOW,
                    )
                    for user_id, username in (
                        (USER_ID, "crypto-user"),
                        (OTHER_USER_ID, "crypto-peer"),
                    )
                ]
            )
            await session.flush()
            session.add(
                DeviceModel(
                    id=DEVICE_ID,
                    user_id=USER_ID,
                    name="Browser",
                    created_at=NOW,
                    last_seen_at=NOW,
                    revoked_at=None,
                    login_ip=None,
                    last_ip=None,
                )
            )
            await session.flush()
            await SqlAlchemyConversationRepository(session).add(conversation)

        def first_uow() -> DeviceCryptoUnitOfWork:
            return SqlAlchemyDeviceCryptoUnitOfWork(first_sessions)

        await RegisterDeviceCryptoIdentity(
            unit_of_work=first_uow,
            clock=FixedClock(NOW),
            sync_policy=SYNC_POLICY,
        ).execute(command)
    finally:
        await first_engine.dispose()

    second_engine = create_engine(database_url)
    second_sessions = create_session_factory(second_engine)
    try:

        def second_uow() -> DeviceCryptoUnitOfWork:
            return SqlAlchemyDeviceCryptoUnitOfWork(second_sessions)

        await RegisterDeviceCryptoIdentity(
            unit_of_work=second_uow,
            clock=FixedClock(NOW),
            sync_policy=SYNC_POLICY,
        ).execute(command)
        async with second_sessions() as session:
            events = (await session.scalars(select(SyncEventModel))).all()
        assert {(event.user_id, event.conversation_id) for event in events} == {
            (USER_ID, CONVERSATION_ID),
            (OTHER_USER_ID, CONVERSATION_ID),
        }
    finally:
        await reset_tables(second_sessions)
        await second_engine.dispose()
