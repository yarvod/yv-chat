"""Opaque message domain invariants."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.domain.entities import Message, MessageDeletionReason
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def test_message_preserves_opaque_bytes_without_plaintext_contract() -> None:
    ciphertext = b"\x00\xffopaque-envelope"
    message = Message.create(
        conversation_id=uuid4(),
        client_message_id=uuid4(),
        sender_user_id=uuid4(),
        sender_device_id=uuid4(),
        protocol_version=1,
        sequence=1,
        ciphertext=ciphertext,
        now=NOW,
        retention=timedelta(days=30),
    )

    assert message.ciphertext == ciphertext
    assert "plaintext" not in message.__dataclass_fields__
    assert "message_key" not in message.__dataclass_fields__
    assert message.expires_at == NOW + timedelta(days=30)


def test_message_tombstone_scrubs_ciphertext_and_preserves_digest() -> None:
    actor_id = uuid4()
    message = Message.create(
        conversation_id=uuid4(),
        client_message_id=uuid4(),
        sender_user_id=actor_id,
        sender_device_id=uuid4(),
        protocol_version=1,
        sequence=1,
        ciphertext=b"opaque",
        now=NOW,
        retention=timedelta(days=30),
    )

    tombstone = message.to_tombstone(
        now=NOW + timedelta(minutes=1),
        tombstone_retention=timedelta(days=90),
        reason=MessageDeletionReason.MANUAL,
        deleted_by_user_id=actor_id,
    )

    assert tombstone.ciphertext is None
    assert tombstone.ciphertext_digest == message.ciphertext_digest
    assert (
        tombstone.to_tombstone(
            now=NOW + timedelta(days=1),
            tombstone_retention=timedelta(days=90),
            reason=MessageDeletionReason.MANUAL,
            deleted_by_user_id=actor_id,
        )
        == tombstone
    )


def test_message_rejects_manual_tombstone_without_actor() -> None:
    message = Message.create(
        conversation_id=uuid4(),
        client_message_id=uuid4(),
        sender_user_id=uuid4(),
        sender_device_id=uuid4(),
        protocol_version=1,
        sequence=1,
        ciphertext=b"opaque",
        now=NOW,
        retention=timedelta(days=30),
    )
    with pytest.raises(DomainValidationError, match="requires an actor"):
        message.to_tombstone(
            now=NOW + timedelta(minutes=1),
            tombstone_retention=timedelta(days=90),
            reason=MessageDeletionReason.MANUAL,
            deleted_by_user_id=None,
        )


def test_message_rejects_empty_ciphertext() -> None:
    with pytest.raises(DomainValidationError, match="opaque bytes"):
        Message.create(
            conversation_id=uuid4(),
            client_message_id=uuid4(),
            sender_user_id=uuid4(),
            sender_device_id=uuid4(),
            protocol_version=1,
            sequence=1,
            ciphertext=b"",
            now=NOW,
            retention=timedelta(days=30),
        )


def test_message_rejects_non_positive_version_and_naive_time() -> None:
    conversation_id = uuid4()
    sender_user_id = uuid4()
    sender_device_id = uuid4()
    with pytest.raises(DomainValidationError, match="positive"):
        Message.create(
            conversation_id=conversation_id,
            client_message_id=uuid4(),
            sender_user_id=sender_user_id,
            sender_device_id=sender_device_id,
            protocol_version=0,
            sequence=1,
            ciphertext=b"opaque",
            now=NOW,
            retention=timedelta(days=30),
        )
    with pytest.raises(DomainValidationError, match="timezone-aware"):
        Message.create(
            conversation_id=conversation_id,
            client_message_id=uuid4(),
            sender_user_id=sender_user_id,
            sender_device_id=sender_device_id,
            protocol_version=1,
            sequence=1,
            ciphertext=b"opaque",
            now=datetime(2026, 8, 11, 12, 0),
            retention=timedelta(days=30),
        )
