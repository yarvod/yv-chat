"""PostgreSQL concurrency contract for one-time KeyPackage claims."""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from messenger.application.device_crypto.claim_key_package import (
    ClaimDeviceKeyPackage,
    ClaimDeviceKeyPackageCommand,
)
from messenger.application.device_crypto.register import (
    RegisterDeviceCryptoIdentity,
    RegisterDeviceCryptoIdentityCommand,
)
from messenger.application.device_crypto.replenish_key_packages import (
    ReplenishDeviceKeyPackages,
    ReplenishDeviceKeyPackagesCommand,
)
from messenger.application.errors import DeviceKeyPackageUnavailableError
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
ALICE_ID = UUID("1b0a32e8-144f-4f60-bcb6-112f71bd5316")
ALICE_DEVICE_ONE = UUID("50d6b08a-84ae-4bd7-829a-f40f38e9a2c1")
ALICE_DEVICE_TWO = UUID("b7920cfa-3c11-4b32-abff-1855b264f259")
BOB_ID = UUID("ce1ecf72-b414-4e65-901f-18ebc7fe3cee")
BOB_DEVICE = UUID("912608ec-8e20-497d-a55b-ec5d260480cc")
CONVERSATION_ID = UUID("d959239f-8a90-45b6-ae27-e8216cea1681")
SYNC_POLICY = SyncPolicy(retention=timedelta(days=30))


def configured_database_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


async def cleanup(session_factory: async_sessionmaker[AsyncSession]) -> None:
    device_ids = {ALICE_DEVICE_ONE, ALICE_DEVICE_TWO, BOB_DEVICE}
    async with session_factory.begin() as session:
        await session.execute(
            delete(SyncEventModel).where(SyncEventModel.conversation_id == CONVERSATION_ID)
        )
        await session.execute(
            delete(SyncStreamModel).where(SyncStreamModel.user_id.in_({ALICE_ID, BOB_ID}))
        )
        await session.execute(
            delete(DeviceKeyPackageModel).where(DeviceKeyPackageModel.device_id.in_(device_ids))
        )
        await session.execute(
            delete(DeviceCryptoIdentityModel).where(
                DeviceCryptoIdentityModel.device_id.in_(device_ids)
            )
        )
        await session.execute(
            delete(ConversationMemberModel).where(
                ConversationMemberModel.conversation_id == CONVERSATION_ID
            )
        )
        await session.execute(
            delete(ConversationModel).where(ConversationModel.id == CONVERSATION_ID)
        )
        await session.execute(delete(DeviceModel).where(DeviceModel.id.in_(device_ids)))
        await session.execute(delete(UserModel).where(UserModel.id.in_({ALICE_ID, BOB_ID})))


@pytest.mark.integration
async def test_claim_concurrency_preserves_exact_retry_and_single_consumption() -> None:
    engine = create_engine(configured_database_url())
    session_factory = create_session_factory(engine)

    def unit_of_work() -> DeviceCryptoUnitOfWork:
        return SqlAlchemyDeviceCryptoUnitOfWork(session_factory)

    try:
        await cleanup(session_factory)
        conversation = Conversation.create_direct(
            created_by=ALICE_ID,
            other_user_id=BOB_ID,
            now=NOW,
            conversation_id=CONVERSATION_ID,
        )
        async with session_factory.begin() as session:
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
                    for user_id, username in ((ALICE_ID, "kp-alice"), (BOB_ID, "kp-bob"))
                ]
            )
            await session.flush()
            session.add_all(
                [
                    DeviceModel(
                        id=device_id,
                        user_id=user_id,
                        name="Browser",
                        created_at=NOW,
                        last_seen_at=NOW,
                        revoked_at=None,
                        login_ip=None,
                        last_ip=None,
                    )
                    for user_id, device_id in (
                        (ALICE_ID, ALICE_DEVICE_ONE),
                        (ALICE_ID, ALICE_DEVICE_TWO),
                        (BOB_ID, BOB_DEVICE),
                    )
                ]
            )
            await session.flush()
            await SqlAlchemyConversationRepository(session).add(conversation)

        register = RegisterDeviceCryptoIdentity(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
            sync_policy=SYNC_POLICY,
        )
        for user_id, device_id, package in (
            (ALICE_ID, ALICE_DEVICE_ONE, b"alice-one"),
            (ALICE_ID, ALICE_DEVICE_TWO, b"alice-two"),
            (BOB_ID, BOB_DEVICE, b"bob-one"),
        ):
            await register.execute(
                RegisterDeviceCryptoIdentityCommand(
                    user_id=user_id,
                    device_id=device_id,
                    credential_identity=expected_credential_identity(user_id, device_id),
                    signature_public_key=device_id.bytes * 2,
                    key_package=package,
                )
            )
        await ReplenishDeviceKeyPackages(
            unit_of_work=unit_of_work,
            clock=FixedClock(NOW),
        ).execute(
            ReplenishDeviceKeyPackagesCommand(
                user_id=BOB_ID,
                device_id=BOB_DEVICE,
                key_packages=(b"bob-two",),
            )
        )

        exact = ClaimDeviceKeyPackageCommand(
            user_id=ALICE_ID,
            device_id=ALICE_DEVICE_ONE,
            conversation_id=CONVERSATION_ID,
            target_device_id=BOB_DEVICE,
            claim_request_id=uuid4(),
        )
        first, retry = await asyncio.gather(
            ClaimDeviceKeyPackage(unit_of_work=unit_of_work, clock=FixedClock(NOW)).execute(exact),
            ClaimDeviceKeyPackage(unit_of_work=unit_of_work, clock=FixedClock(NOW)).execute(exact),
        )
        assert first == retry

        distinct = await asyncio.gather(
            *(
                ClaimDeviceKeyPackage(
                    unit_of_work=unit_of_work,
                    clock=FixedClock(NOW),
                ).execute(
                    ClaimDeviceKeyPackageCommand(
                        user_id=ALICE_ID,
                        device_id=device_id,
                        conversation_id=CONVERSATION_ID,
                        target_device_id=BOB_DEVICE,
                        claim_request_id=uuid4(),
                    )
                )
                for device_id in (ALICE_DEVICE_ONE, ALICE_DEVICE_TWO)
            ),
            return_exceptions=True,
        )
        assert sum(not isinstance(result, Exception) for result in distinct) == 1
        assert sum(isinstance(result, DeviceKeyPackageUnavailableError) for result in distinct) == 1

        async with session_factory() as session:
            packages = (
                await session.scalars(
                    select(DeviceKeyPackageModel).where(
                        DeviceKeyPackageModel.device_id == BOB_DEVICE
                    )
                )
            ).all()
        assert len(packages) == 2
        assert all(package.claimed_at is not None for package in packages)
        assert len({package.claim_request_id for package in packages}) == 2
    finally:
        await cleanup(session_factory)
        await engine.dispose()
