"""Password-reset credential domain invariants."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.domain.entities import PasswordResetToken
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("c49b454d-e88b-4bb5-a484-a2ec00dad34c")


def test_reset_token_has_exclusive_single_use_lifecycle() -> None:
    token = PasswordResetToken.create(
        user_id=USER_ID,
        token_hash="a" * 64,
        created_at=NOW,
        expires_at=NOW + timedelta(hours=1),
    )

    assert token.is_expired(NOW + timedelta(minutes=59)) is False
    assert token.is_expired(NOW + timedelta(hours=1)) is True
    used = token.mark_used(NOW + timedelta(minutes=10))
    assert used.used_at == NOW + timedelta(minutes=10)
    assert used.revoke(NOW + timedelta(minutes=11)) is used


def test_revoked_reset_token_cannot_be_consumed() -> None:
    token = PasswordResetToken.create(
        user_id=USER_ID,
        token_hash="b" * 64,
        created_at=NOW,
        expires_at=NOW + timedelta(hours=1),
    ).revoke(NOW + timedelta(minutes=1))

    with pytest.raises(DomainValidationError, match="revoked"):
        token.mark_used(NOW + timedelta(minutes=2))


@pytest.mark.parametrize("token_hash", ["", "not-hex", "A" * 64, "a" * 63])
def test_reset_token_requires_sha256_lookup_digest(token_hash: str) -> None:
    with pytest.raises(DomainValidationError, match="token_hash"):
        PasswordResetToken.create(
            user_id=USER_ID,
            token_hash=token_hash,
            created_at=NOW,
            expires_at=NOW + timedelta(hours=1),
        )
