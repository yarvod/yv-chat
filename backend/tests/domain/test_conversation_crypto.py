from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.domain.entities import (
    ConversationCryptoBlockReason,
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    ConversationCryptoStatus,
    ConversationCryptoWelcome,
)
from messenger.domain.exceptions import DomainValidationError


def now() -> datetime:
    return datetime(2026, 8, 11, 18, 0, tzinfo=UTC)


def pending_generation() -> ConversationCryptoGeneration:
    return ConversationCryptoGeneration.create(
        conversation_id=uuid4(),
        generation_number=1,
        coordinator_user_id=uuid4(),
        coordinator_device_id=uuid4(),
        bootstrap_request_id=uuid4(),
        now=now(),
    )


def test_generation_is_pending_until_complete_opaque_payload_is_finalized() -> None:
    generation = pending_generation()
    assert generation.status is ConversationCryptoStatus.PENDING
    assert generation.epoch is None

    ready = generation.finalize(
        epoch=1,
        commit_message=b"opaque commit",
        ratchet_tree=b"opaque tree",
        now=now() + timedelta(seconds=1),
    )
    assert ready.status is ConversationCryptoStatus.READY
    assert ready.epoch == 1
    assert ready.ready_at == now() + timedelta(seconds=1)

    with pytest.raises(DomainValidationError):
        ready.finalize(
            epoch=2,
            commit_message=b"another commit",
            ratchet_tree=b"another tree",
            now=now() + timedelta(seconds=2),
        )


def test_ready_generation_blocks_without_destroying_audit_payload() -> None:
    ready = pending_generation().finalize(
        epoch=1,
        commit_message=b"opaque commit",
        ratchet_tree=b"opaque tree",
        now=now() + timedelta(seconds=1),
    )
    blocked = ready.block(
        ConversationCryptoBlockReason.DEVICE_ROSTER_CHANGED,
        now() + timedelta(seconds=2),
    )
    assert blocked.status is ConversationCryptoStatus.BLOCKED
    assert blocked.commit_message == ready.commit_message
    assert blocked.block_reason is ConversationCryptoBlockReason.DEVICE_ROSTER_CHANGED
    assert blocked.supersede(now() + timedelta(seconds=3)).is_current is False


def test_required_device_never_claims_the_coordinator_package() -> None:
    coordinator = ConversationCryptoRequiredDevice(
        generation_id=uuid4(),
        user_id=uuid4(),
        device_id=uuid4(),
        is_coordinator=True,
        key_package_id=None,
        snapshot_at=now(),
    )
    with pytest.raises(DomainValidationError):
        coordinator.bind_key_package(uuid4())

    recipient = ConversationCryptoRequiredDevice(
        generation_id=coordinator.generation_id,
        user_id=uuid4(),
        device_id=uuid4(),
        is_coordinator=False,
        key_package_id=None,
        snapshot_at=now(),
    )
    package_id = uuid4()
    assert recipient.bind_key_package(package_id).key_package_id == package_id


def test_welcome_has_bounded_ttl_and_idempotent_acknowledgement() -> None:
    welcome = ConversationCryptoWelcome(
        generation_id=uuid4(),
        target_device_id=uuid4(),
        welcome_message=b"opaque welcome",
        created_at=now(),
        expires_at=now() + timedelta(days=7),
    )
    acknowledged = welcome.acknowledge(now() + timedelta(minutes=1))
    assert acknowledged.acknowledged_at == now() + timedelta(minutes=1)
    assert acknowledged.acknowledge(now() + timedelta(minutes=2)) == acknowledged

    with pytest.raises(DomainValidationError):
        welcome.acknowledge(welcome.expires_at)
