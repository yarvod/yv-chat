"""Application specifications for atomic MLS generation coordination."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.application.conversation_crypto.acknowledge_welcome import (
    AcknowledgeConversationCryptoWelcome,
    AcknowledgeConversationCryptoWelcomeCommand,
)
from messenger.application.conversation_crypto.begin import (
    BeginConversationCrypto,
    BeginConversationCryptoCommand,
)
from messenger.application.conversation_crypto.finalize import (
    DeviceWelcomeInput,
    FinalizeConversationCrypto,
    FinalizeConversationCryptoCommand,
)
from messenger.application.conversation_crypto.get_current import (
    GetCurrentConversationCrypto,
    GetCurrentConversationCryptoQuery,
)
from messenger.application.conversation_crypto.list_updates import (
    ListConversationCryptoUpdates,
    ListConversationCryptoUpdatesQuery,
)
from messenger.application.errors import ConversationCryptoConflictError
from messenger.domain.entities import (
    Conversation,
    ConversationCryptoBlockReason,
    ConversationCryptoStatus,
    Device,
    DeviceCryptoIdentity,
    DeviceKeyPackage,
)
from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from tests.application.fakes import (
    FakeConversationCryptoUnitOfWorkFactory,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
ALICE_ID = UUID("11111111-1111-4111-8111-111111111111")
BOB_ID = UUID("22222222-2222-4222-8222-222222222222")
ALICE_PHONE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")
ALICE_LAPTOP_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2")
BOB_PHONE_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1")
BOB_LAPTOP_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2")
CONVERSATION_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
BOOTSTRAP_REQUEST_ID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")


def crypto_identity(user_id: UUID, device_id: UUID, marker: int) -> DeviceCryptoIdentity:
    return DeviceCryptoIdentity.create(
        user_id=user_id,
        device_id=device_id,
        credential_identity=expected_credential_identity(user_id, device_id),
        signature_public_key=bytes([marker]) * 32,
        now=NOW,
    )


def bootstrap_state(*, omit_identity: UUID | None = None) -> IdentityState:
    conversation = Conversation.create_direct(
        created_by=ALICE_ID,
        other_user_id=BOB_ID,
        now=NOW,
        conversation_id=CONVERSATION_ID,
    )
    devices = {
        ALICE_PHONE_ID: Device.create(
            user_id=ALICE_ID,
            name="Alice phone",
            now=NOW,
            device_id=ALICE_PHONE_ID,
        ),
        ALICE_LAPTOP_ID: Device.create(
            user_id=ALICE_ID,
            name="Alice laptop",
            now=NOW,
            device_id=ALICE_LAPTOP_ID,
        ),
        BOB_PHONE_ID: Device.create(
            user_id=BOB_ID,
            name="Bob phone",
            now=NOW,
            device_id=BOB_PHONE_ID,
        ),
    }
    identities = {
        device_id: crypto_identity(device.user_id, device_id, index + 1)
        for index, (device_id, device) in enumerate(devices.items())
        if device_id != omit_identity
    }
    packages = tuple(
        DeviceKeyPackage.create(
            user_id=device.user_id,
            device_id=device_id,
            key_package=f"public-package-{device_id}".encode(),
            now=NOW,
        )
        for device_id, device in devices.items()
    )
    return IdentityState(
        devices=devices,
        device_crypto_identities=identities,
        device_key_packages={item.id: item for item in packages},
        conversations={CONVERSATION_ID: conversation},
    )


def begin_command() -> BeginConversationCryptoCommand:
    return BeginConversationCryptoCommand(
        user_id=ALICE_ID,
        device_id=ALICE_PHONE_ID,
        conversation_id=CONVERSATION_ID,
        bootstrap_request_id=BOOTSTRAP_REQUEST_ID,
    )


async def test_bootstrap_snapshots_all_active_devices_and_claims_each_target_once() -> None:
    state = bootstrap_state()
    factory = FakeConversationCryptoUnitOfWorkFactory(state)
    use_case = BeginConversationCrypto(unit_of_work=factory, clock=FixedClock(NOW))

    created = await use_case.execute(begin_command())
    retried = await use_case.execute(begin_command())

    assert retried == created
    assert created.generation.status is ConversationCryptoStatus.PENDING
    assert {item.device_id for item in created.required_devices} == {
        ALICE_PHONE_ID,
        ALICE_LAPTOP_ID,
        BOB_PHONE_ID,
    }
    coordinator = next(item for item in created.required_devices if item.is_coordinator)
    assert coordinator.device_id == ALICE_PHONE_ID
    assert coordinator.key_package is None
    targets = [item for item in created.required_devices if not item.is_coordinator]
    assert all(item.key_package is not None for item in targets)
    claimed = [item for item in state.device_key_packages.values() if item.is_claimed]
    assert {item.device_id for item in claimed} == {ALICE_LAPTOP_ID, BOB_PHONE_ID}
    assert all(item.claim_conversation_id == CONVERSATION_ID for item in claimed)
    assert state.commits == 1


async def test_unenrolled_legacy_device_does_not_block_capable_devices() -> None:
    state = bootstrap_state(omit_identity=BOB_PHONE_ID)
    factory = FakeConversationCryptoUnitOfWorkFactory(state)
    use_case = BeginConversationCrypto(
        unit_of_work=factory,
        clock=FixedClock(NOW),
    )

    result = await use_case.execute(begin_command())

    assert result.generation.status is ConversationCryptoStatus.PENDING
    assert {item.device_id for item in result.required_devices} == {
        ALICE_PHONE_ID,
        ALICE_LAPTOP_ID,
    }
    claimed = [item for item in state.device_key_packages.values() if item.is_claimed]
    assert {item.device_id for item in claimed} == {ALICE_LAPTOP_ID}
    assert len(state.conversation_crypto_generations) == 1
    assert state.commits == 1


async def test_current_device_without_identity_is_blocked_without_consuming_packages() -> None:
    state = bootstrap_state(omit_identity=ALICE_PHONE_ID)
    factory = FakeConversationCryptoUnitOfWorkFactory(state)
    use_case = BeginConversationCrypto(unit_of_work=factory, clock=FixedClock(NOW))

    result = await use_case.execute(begin_command())
    retried = await use_case.execute(begin_command())

    assert retried == result
    assert result.generation.status is ConversationCryptoStatus.BLOCKED
    assert result.generation.block_reason is ConversationCryptoBlockReason.MISSING_IDENTITY
    assert not any(item.is_claimed for item in state.device_key_packages.values())
    assert len(state.conversation_crypto_generations) == 1
    assert state.commits == 1


async def test_finalize_routes_exact_welcomes_and_device_ack_is_idempotent() -> None:
    state = bootstrap_state()
    factory = FakeConversationCryptoUnitOfWorkFactory(state)
    generation = (
        await BeginConversationCrypto(unit_of_work=factory, clock=FixedClock(NOW)).execute(
            begin_command()
        )
    ).generation
    welcomes = (
        DeviceWelcomeInput(ALICE_LAPTOP_ID, b"welcome-alice-laptop"),
        DeviceWelcomeInput(BOB_PHONE_ID, b"welcome-bob-phone"),
    )
    finalize_command = FinalizeConversationCryptoCommand(
        user_id=ALICE_ID,
        device_id=ALICE_PHONE_ID,
        conversation_id=CONVERSATION_ID,
        generation_id=generation.id,
        epoch=1,
        commit_message=b"opaque-commit",
        ratchet_tree=b"opaque-ratchet-tree",
        welcomes=welcomes,
    )
    ready = await FinalizeConversationCrypto(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(seconds=1)),
    ).execute(finalize_command)
    retried = await FinalizeConversationCrypto(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(seconds=2)),
    ).execute(finalize_command)

    assert retried == ready
    assert ready.generation.status is ConversationCryptoStatus.READY
    bob = await GetCurrentConversationCrypto(unit_of_work=factory).execute(
        GetCurrentConversationCryptoQuery(BOB_ID, BOB_PHONE_ID, CONVERSATION_ID)
    )
    assert bob.welcome is not None
    assert bob.welcome.target_device_id == BOB_PHONE_ID
    assert bob.welcome.welcome_message == b"welcome-bob-phone"

    ack = AcknowledgeConversationCryptoWelcome(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(minutes=1)),
    )
    ack_command = AcknowledgeConversationCryptoWelcomeCommand(
        BOB_ID,
        BOB_PHONE_ID,
        CONVERSATION_ID,
        generation.id,
    )
    await ack.execute(ack_command)
    await ack.execute(ack_command)
    stored = state.conversation_crypto_welcomes[(generation.id, BOB_PHONE_ID)]
    assert stored.acknowledged_at == NOW + timedelta(minutes=1)

    with pytest.raises(ConversationCryptoConflictError):
        await FinalizeConversationCrypto(
            unit_of_work=factory,
            clock=FixedClock(NOW + timedelta(minutes=2)),
        ).execute(
            replace(
                finalize_command,
                welcomes=(
                    DeviceWelcomeInput(ALICE_LAPTOP_ID, b"changed"),
                    welcomes[1],
                ),
            )
        )


async def test_ready_roster_drift_creates_incremental_generation_and_only_claims_new_leaf() -> None:
    state = bootstrap_state()
    factory = FakeConversationCryptoUnitOfWorkFactory(state)
    first = (
        await BeginConversationCrypto(unit_of_work=factory, clock=FixedClock(NOW)).execute(
            begin_command()
        )
    ).generation
    await FinalizeConversationCrypto(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(seconds=1)),
    ).execute(
        FinalizeConversationCryptoCommand(
            user_id=ALICE_ID,
            device_id=ALICE_PHONE_ID,
            conversation_id=CONVERSATION_ID,
            generation_id=first.id,
            epoch=1,
            commit_message=b"initial-commit",
            ratchet_tree=b"initial-tree",
            welcomes=(
                DeviceWelcomeInput(ALICE_LAPTOP_ID, b"welcome-alice-laptop"),
                DeviceWelcomeInput(BOB_PHONE_ID, b"welcome-bob-phone"),
            ),
        )
    )
    bob_laptop = Device.create(
        user_id=BOB_ID,
        name="Bob laptop",
        now=NOW + timedelta(seconds=2),
        device_id=BOB_LAPTOP_ID,
    )
    state.devices[BOB_LAPTOP_ID] = bob_laptop
    state.device_crypto_identities[BOB_LAPTOP_ID] = crypto_identity(
        BOB_ID,
        BOB_LAPTOP_ID,
        9,
    )
    new_package = DeviceKeyPackage.create(
        user_id=BOB_ID,
        device_id=BOB_LAPTOP_ID,
        key_package=b"public-package-bob-laptop",
        now=NOW + timedelta(seconds=2),
    )
    state.device_key_packages[new_package.id] = new_package

    second = await BeginConversationCrypto(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(seconds=3)),
    ).execute(
        replace(
            begin_command(),
            bootstrap_request_id=UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
        )
    )

    assert second.generation.generation_number == 2
    assert second.generation.coordinator_device_id == ALICE_PHONE_ID
    assert second.generation.status is ConversationCryptoStatus.PENDING
    by_device = {item.device_id: item for item in second.required_devices}
    assert by_device[BOB_LAPTOP_ID].key_package is not None
    assert by_device[ALICE_LAPTOP_ID].key_package is None
    assert by_device[BOB_PHONE_ID].key_package is None
    assert state.conversation_crypto_generations[first.id].is_current is False

    ready = await FinalizeConversationCrypto(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(seconds=4)),
    ).execute(
        FinalizeConversationCryptoCommand(
            user_id=ALICE_ID,
            device_id=ALICE_PHONE_ID,
            conversation_id=CONVERSATION_ID,
            generation_id=second.generation.id,
            epoch=2,
            commit_message=b"incremental-commit",
            ratchet_tree=b"incremental-tree",
            welcomes=(DeviceWelcomeInput(BOB_LAPTOP_ID, b"welcome-bob-laptop"),),
        )
    )
    assert ready.generation.status is ConversationCryptoStatus.READY
    assert (second.generation.id, BOB_LAPTOP_ID) in state.conversation_crypto_welcomes

    updates = ListConversationCryptoUpdates(unit_of_work=factory)
    alice_laptop_updates = await updates.execute(
        ListConversationCryptoUpdatesQuery(
            ALICE_ID,
            ALICE_LAPTOP_ID,
            CONVERSATION_ID,
            after_generation_number=0,
        )
    )
    assert [item.generation.generation_number for item in alice_laptop_updates] == [1, 2]
    assert alice_laptop_updates[0].welcome is not None
    assert alice_laptop_updates[1].welcome is None

    bob_laptop_updates = await updates.execute(
        ListConversationCryptoUpdatesQuery(
            BOB_ID,
            BOB_LAPTOP_ID,
            CONVERSATION_ID,
            after_generation_number=0,
        )
    )
    assert [item.generation.generation_number for item in bob_laptop_updates] == [2]
    assert bob_laptop_updates[0].welcome is not None
