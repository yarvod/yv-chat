"""Opaque message domain invariants."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from messenger.domain.entities import Message
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
    )

    assert message.ciphertext == ciphertext
    assert "plaintext" not in message.__dataclass_fields__
    assert "message_key" not in message.__dataclass_fields__


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
        )
