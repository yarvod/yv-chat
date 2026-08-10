"""Opaque session domain invariants."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.domain.entities import Session
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("21a349f1-3705-4e60-a24a-eef041f766ce")
DEVICE_ID = UUID("3f95930a-426a-460a-9438-a7a234bf3734")
FIRST_HASH = "a" * 64
SECOND_HASH = "b" * 64


def create_session() -> Session:
    return Session.create(
        user_id=USER_ID,
        device_id=DEVICE_ID,
        token_hash=FIRST_HASH,
        now=NOW,
        idle_timeout=timedelta(hours=2),
        absolute_lifetime=timedelta(hours=3),
    )


def test_touch_slides_idle_expiry_but_never_absolute_expiry() -> None:
    session = create_session()

    touched = session.touch(NOW + timedelta(hours=2, seconds=-1), timedelta(hours=2))

    assert touched.last_seen_at == NOW + timedelta(hours=2, seconds=-1)
    assert touched.idle_expires_at == NOW + timedelta(hours=3)
    assert touched.absolute_expires_at == session.absolute_expires_at


def test_rotation_preserves_previous_hash_only_for_grace_period() -> None:
    session = create_session()
    rotated_at = NOW + timedelta(hours=1)

    rotated = session.rotate(
        new_token_hash=SECOND_HASH,
        now=rotated_at,
        previous_token_grace=timedelta(seconds=60),
    )

    assert rotated.current_token_hash == SECOND_HASH
    assert rotated.previous_token_hash == FIRST_HASH
    assert rotated.previous_token_is_valid(rotated_at + timedelta(seconds=59))
    assert not rotated.previous_token_is_valid(rotated_at + timedelta(seconds=60))


def test_session_rejects_plaintext_or_malformed_lookup_hash() -> None:
    with pytest.raises(DomainValidationError, match="SHA-256"):
        Session.create(
            user_id=USER_ID,
            device_id=DEVICE_ID,
            token_hash="plaintext-secret",
            now=NOW,
            idle_timeout=timedelta(hours=1),
            absolute_lifetime=timedelta(hours=2),
        )


def test_expired_or_revoked_session_cannot_be_touched() -> None:
    session = create_session()

    with pytest.raises(DomainValidationError, match="inactive"):
        session.touch(NOW + timedelta(hours=2), timedelta(hours=1))

    with pytest.raises(DomainValidationError, match="inactive"):
        session.revoke(NOW + timedelta(minutes=1)).touch(
            NOW + timedelta(minutes=2),
            timedelta(hours=1),
        )
