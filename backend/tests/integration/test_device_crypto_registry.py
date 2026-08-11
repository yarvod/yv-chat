"""PostgreSQL concurrency contract for immutable device crypto registration."""

import asyncio
import os
from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.device_crypto.register import (
    RegisterDeviceCryptoIdentity,
    RegisterDeviceCryptoIdentityCommand,
)
from messenger.application.ports.device_crypto import DeviceCryptoUnitOfWork
from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.device_crypto_uow import (
    SqlAlchemyDeviceCryptoUnitOfWork,
)
from messenger.infrastructure.persistence.models import (
    DeviceCryptoIdentityModel,
    DeviceKeyPackageModel,
    DeviceModel,
    UserModel,
)
from tests.application.fakes import FixedClock

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("1b0a32e8-144f-4f60-bcb6-112f71bd5316")
DEVICE_ID = UUID("50d6b08a-84ae-4bd7-829a-f40f38e9a2c1")


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def reset_tables(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory.begin() as session:
        await session.execute(delete(DeviceKeyPackageModel))
        await session.execute(delete(DeviceCryptoIdentityModel))
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
            ).execute(command),
            RegisterDeviceCryptoIdentity(
                unit_of_work=unit_of_work,
                clock=FixedClock(NOW),
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
