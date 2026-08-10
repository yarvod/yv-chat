"""Activation token domain invariants."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.domain.entities import ActivationToken
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("c49b454d-e88b-4bb5-a484-a2ec00dad34c")


def test_token_expires_at_exact_boundary_and_can_be_consumed_before_it() -> None:
    token = ActivationToken.create(
        user_id=USER_ID,
        token_hash="c" * 64,
        created_at=NOW,
        expires_at=NOW + timedelta(hours=1),
    )

    assert token.is_expired(NOW + timedelta(minutes=59)) is False
    assert token.is_expired(NOW + timedelta(hours=1)) is True
    assert token.mark_used(NOW + timedelta(minutes=30)).used_at == NOW + timedelta(minutes=30)


@pytest.mark.parametrize("token_hash", ["", "not-hex", "A" * 64, "a" * 63])
def test_token_requires_sha256_lookup_digest(token_hash: str) -> None:
    with pytest.raises(DomainValidationError, match="token_hash"):
        ActivationToken.create(
            user_id=USER_ID,
            token_hash=token_hash,
            created_at=NOW,
            expires_at=NOW + timedelta(hours=1),
        )
