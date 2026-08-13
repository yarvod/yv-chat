"""Application specifications for bounded one-time MLS KeyPackage delivery."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from messenger.application.device_crypto.claim_key_package import (
    ClaimDeviceKeyPackage,
    ClaimDeviceKeyPackageCommand,
)
from messenger.application.device_crypto.list_key_packages import (
    ListDeviceKeyPackageInventory,
    ListDeviceKeyPackageInventoryQuery,
)
from messenger.application.device_crypto.register import (
    RegisterDeviceCryptoIdentity,
    RegisterDeviceCryptoIdentityCommand,
)
from messenger.application.device_crypto.replenish_key_packages import (
    ReplenishDeviceKeyPackages,
    ReplenishDeviceKeyPackagesCommand,
)
from messenger.application.errors import (
    ConversationNotFoundError,
    DeviceKeyPackageConflictError,
    DeviceKeyPackageUnavailableError,
)
from messenger.application.sync.policy import SyncPolicy
from messenger.domain.entities import Conversation, Device
from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from messenger.domain.exceptions import DomainValidationError
from tests.application.fakes import (
    FakeDeviceCryptoUnitOfWorkFactory,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
ALICE_ID = UUID("1b0a32e8-144f-4f60-bcb6-112f71bd5316")
ALICE_DEVICE_ID = UUID("50d6b08a-84ae-4bd7-829a-f40f38e9a2c1")
BOB_ID = UUID("ce1ecf72-b414-4e65-901f-18ebc7fe3cee")
BOB_DEVICE_ID = UUID("912608ec-8e20-497d-a55b-ec5d260480cc")
SYNC_POLICY = SyncPolicy(retention=timedelta(days=30))


async def registered_state() -> tuple[IdentityState, Conversation]:
    devices = {
        ALICE_DEVICE_ID: Device.create(
            user_id=ALICE_ID, name="Alice browser", now=NOW, device_id=ALICE_DEVICE_ID
        ),
        BOB_DEVICE_ID: Device.create(
            user_id=BOB_ID, name="Bob browser", now=NOW, device_id=BOB_DEVICE_ID
        ),
    }
    conversation = Conversation.create_direct(
        created_by=ALICE_ID,
        other_user_id=BOB_ID,
        now=NOW,
    )
    state = IdentityState(devices=devices, conversations={conversation.id: conversation})
    register = RegisterDeviceCryptoIdentity(
        unit_of_work=FakeDeviceCryptoUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        sync_policy=SYNC_POLICY,
    )
    for user_id, device_id, package in (
        (ALICE_ID, ALICE_DEVICE_ID, b"alice-initial-package"),
        (BOB_ID, BOB_DEVICE_ID, b"bob-initial-package"),
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
    return state, conversation


async def test_claim_is_one_time_idempotent_and_bound_to_exact_target() -> None:
    state, conversation = await registered_state()
    other_conversation = Conversation.create_direct(
        created_by=ALICE_ID,
        other_user_id=BOB_ID,
        now=NOW,
    )
    state.conversations[other_conversation.id] = other_conversation
    factory = FakeDeviceCryptoUnitOfWorkFactory(state)
    claim = ClaimDeviceKeyPackage(unit_of_work=factory, clock=FixedClock(NOW))
    request_id = uuid4()
    command = ClaimDeviceKeyPackageCommand(
        user_id=ALICE_ID,
        device_id=ALICE_DEVICE_ID,
        conversation_id=conversation.id,
        target_device_id=BOB_DEVICE_ID,
        claim_request_id=request_id,
    )

    first = await claim.execute(command)
    retried = await claim.execute(command)

    assert retried == first
    assert first.key_package == b"bob-initial-package"
    assert first.target_user_id == BOB_ID
    assert state.commits == 3  # two registrations and only the first claim
    with pytest.raises(DeviceKeyPackageConflictError):
        await claim.execute(replace(command, conversation_id=other_conversation.id))
    state.devices[BOB_DEVICE_ID] = state.devices[BOB_DEVICE_ID].revoke(NOW + timedelta(seconds=1))
    with pytest.raises(ConversationNotFoundError):
        await claim.execute(command)
    state.devices[BOB_DEVICE_ID] = replace(state.devices[BOB_DEVICE_ID], revoked_at=None)
    with pytest.raises(DeviceKeyPackageUnavailableError):
        await claim.execute(replace(command, claim_request_id=uuid4()))


async def test_claim_rejects_outsider_and_revoked_target() -> None:
    state, conversation = await registered_state()
    outsider_device_id = uuid4()
    outsider_id = uuid4()
    state.devices[outsider_device_id] = Device.create(
        user_id=outsider_id,
        name="Outsider",
        now=NOW,
        device_id=outsider_device_id,
    )
    claim = ClaimDeviceKeyPackage(
        unit_of_work=FakeDeviceCryptoUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
    )
    with pytest.raises(ConversationNotFoundError):
        await claim.execute(
            ClaimDeviceKeyPackageCommand(
                user_id=outsider_id,
                device_id=outsider_device_id,
                conversation_id=conversation.id,
                target_device_id=BOB_DEVICE_ID,
                claim_request_id=uuid4(),
            )
        )

    state.devices[BOB_DEVICE_ID] = state.devices[BOB_DEVICE_ID].revoke(NOW + timedelta(seconds=1))
    with pytest.raises(ConversationNotFoundError):
        await claim.execute(
            ClaimDeviceKeyPackageCommand(
                user_id=ALICE_ID,
                device_id=ALICE_DEVICE_ID,
                conversation_id=conversation.id,
                target_device_id=BOB_DEVICE_ID,
                claim_request_id=uuid4(),
            )
        )


async def test_replenish_is_bounded_atomic_and_inventory_excludes_claimed() -> None:
    state, conversation = await registered_state()
    factory = FakeDeviceCryptoUnitOfWorkFactory(state)
    replenish = ReplenishDeviceKeyPackages(unit_of_work=factory, clock=FixedClock(NOW))
    result = await replenish.execute(
        ReplenishDeviceKeyPackagesCommand(
            user_id=BOB_ID,
            device_id=BOB_DEVICE_ID,
            key_packages=(b"bob-package-two", b"bob-package-three"),
        )
    )
    assert result.added_count == 2
    assert result.available_count == 3

    with pytest.raises(DeviceKeyPackageConflictError):
        await replenish.execute(
            ReplenishDeviceKeyPackagesCommand(
                user_id=BOB_ID,
                device_id=BOB_DEVICE_ID,
                key_packages=(b"duplicate", b"duplicate"),
            )
        )
    with pytest.raises(DomainValidationError):
        await replenish.execute(
            ReplenishDeviceKeyPackagesCommand(
                user_id=BOB_ID,
                device_id=BOB_DEVICE_ID,
                key_packages=(),
            )
        )

    claim = ClaimDeviceKeyPackage(unit_of_work=factory, clock=FixedClock(NOW))
    await claim.execute(
        ClaimDeviceKeyPackageCommand(
            user_id=ALICE_ID,
            device_id=ALICE_DEVICE_ID,
            conversation_id=conversation.id,
            target_device_id=BOB_DEVICE_ID,
            claim_request_id=uuid4(),
        )
    )
    inventory = await ListDeviceKeyPackageInventory(unit_of_work=factory).execute(
        ListDeviceKeyPackageInventoryQuery(BOB_ID, BOB_DEVICE_ID)
    )
    assert inventory.available_count == 2
