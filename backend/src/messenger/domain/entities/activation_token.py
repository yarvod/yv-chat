"""One-time account activation token."""

import re
from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError

TOKEN_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class ActivationToken:
    """Hashed one-time credential used to activate one account."""

    id: UUID
    user_id: UUID
    token_hash: str
    expires_at: datetime
    created_at: datetime
    used_at: datetime | None

    def __post_init__(self) -> None:
        if TOKEN_HASH_PATTERN.fullmatch(self.token_hash) is None:
            raise DomainValidationError("token_hash must be a lowercase SHA-256 digest")
        require_aware_datetime(self.created_at, "created_at")
        require_aware_datetime(self.expires_at, "expires_at")
        if self.expires_at <= self.created_at:
            raise DomainValidationError("expires_at must be after created_at")
        if self.used_at is not None:
            require_aware_datetime(self.used_at, "used_at")
            if self.used_at < self.created_at:
                raise DomainValidationError("used_at must not be before created_at")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        token_hash: str,
        created_at: datetime,
        expires_at: datetime,
        token_id: UUID | None = None,
    ) -> "ActivationToken":
        """Create an unused activation token."""
        return cls(
            id=token_id or uuid4(),
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
            created_at=created_at,
            used_at=None,
        )

    def is_expired(self, now: datetime) -> bool:
        """Treat the expiry instant itself as expired."""
        timestamp = require_aware_datetime(now, "now")
        return timestamp >= self.expires_at

    def mark_used(self, now: datetime) -> "ActivationToken":
        """Return a consumed token without mutating the original entity."""
        timestamp = require_aware_datetime(now, "now")
        if self.used_at is not None:
            raise DomainValidationError("activation token is already used")
        if timestamp < self.created_at:
            raise DomainValidationError("used_at must not be before created_at")
        return replace(self, used_at=timestamp)
