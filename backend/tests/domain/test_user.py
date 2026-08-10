"""User domain invariants."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.domain.entities import User
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def test_create_user_normalizes_identity_fields() -> None:
    user_id = UUID("287e57fb-894f-47cb-ad73-cec428dfd163")

    user = User.create(
        user_id=user_id,
        username="  Alice.Smith ",
        display_name="  Alice Smith  ",
        now=NOW,
        is_admin=True,
    )

    assert user.id == user_id
    assert user.username == "alice.smith"
    assert user.display_name == "Alice Smith"
    assert user.is_admin is True
    assert user.is_active is True
    assert user.created_at == NOW
    assert user.updated_at == NOW


@pytest.mark.parametrize("username", ["ab", "white space", "кириллица", "a" * 33])
def test_create_user_rejects_invalid_username(username: str) -> None:
    with pytest.raises(DomainValidationError, match="username"):
        User.create(username=username, display_name="Alice", now=NOW)


@pytest.mark.parametrize("display_name", ["", "   ", "a" * 81])
def test_create_user_rejects_invalid_display_name(display_name: str) -> None:
    with pytest.raises(DomainValidationError, match="display_name"):
        User.create(username="alice", display_name=display_name, now=NOW)


def test_create_user_rejects_naive_time() -> None:
    with pytest.raises(DomainValidationError, match="timezone-aware"):
        User.create(
            username="alice",
            display_name="Alice",
            now=datetime(2026, 8, 11, 12, 0),
        )


def test_loaded_user_rejects_invalid_timestamp_order() -> None:
    with pytest.raises(DomainValidationError, match="updated_at"):
        User(
            id=UUID("287e57fb-894f-47cb-ad73-cec428dfd163"),
            username="alice",
            display_name="Alice",
            is_admin=False,
            is_active=True,
            created_at=NOW,
            updated_at=NOW - timedelta(seconds=1),
        )
