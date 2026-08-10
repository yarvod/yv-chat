"""Device domain invariants."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.domain.entities import Device
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("21a349f1-3705-4e60-a24a-eef041f766ce")


def test_create_device_preserves_user_ownership() -> None:
    device_id = UUID("3f95930a-426a-460a-9438-a7a234bf3734")

    device = Device.create(
        device_id=device_id,
        user_id=USER_ID,
        name="  Personal laptop  ",
        now=NOW,
    )

    assert device.id == device_id
    assert device.user_id == USER_ID
    assert device.name == "Personal laptop"
    assert device.created_at == NOW
    assert device.last_seen_at == NOW
    assert device.revoked_at is None


@pytest.mark.parametrize("name", ["", "   ", "a" * 81])
def test_create_device_rejects_invalid_name(name: str) -> None:
    with pytest.raises(DomainValidationError, match="name"):
        Device.create(user_id=USER_ID, name=name, now=NOW)


def test_create_device_rejects_naive_time() -> None:
    with pytest.raises(DomainValidationError, match="timezone-aware"):
        Device.create(
            user_id=USER_ID,
            name="Phone",
            now=datetime(2026, 8, 11, 12, 0),
        )


def test_loaded_device_rejects_invalid_last_seen_order() -> None:
    with pytest.raises(DomainValidationError, match="last_seen_at"):
        Device(
            id=UUID("3f95930a-426a-460a-9438-a7a234bf3734"),
            user_id=USER_ID,
            name="Phone",
            created_at=NOW,
            last_seen_at=NOW - timedelta(seconds=1),
            revoked_at=None,
        )
