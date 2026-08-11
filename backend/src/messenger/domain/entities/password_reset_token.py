"""Purpose-bound one-time password-reset token."""

import re
from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError

TOKEN_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class PasswordResetToken:
    """Hashed credential that can only authorize one password reset."""

    id: UUID
    user_id: UUID
    token_hash: str
    expires_at: datetime
    created_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None = None

    def __post_init__(self) -> None:
        if TOKEN_HASH_PATTERN.fullmatch(self.token_hash) is None:
            raise DomainValidationError("token_hash must be a lowercase SHA-256 digest")
        created_at = require_aware_datetime(self.created_at, "created_at")
        expires_at = require_aware_datetime(self.expires_at, "expires_at")
        if expires_at <= created_at:
            raise DomainValidationError("expires_at must be after created_at")
        if self.used_at is not None:
            used_at = require_aware_datetime(self.used_at, "used_at")
            if used_at < created_at:
                raise DomainValidationError("used_at must not be before created_at")
        if self.revoked_at is not None:
            revoked_at = require_aware_datetime(self.revoked_at, "revoked_at")
            if revoked_at < created_at:
                raise DomainValidationError("revoked_at must not be before created_at")
        if self.used_at is not None and self.revoked_at is not None:
            raise DomainValidationError("password reset token cannot be used and revoked")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        token_hash: str,
        created_at: datetime,
        expires_at: datetime,
        token_id: UUID | None = None,
    ) -> "PasswordResetToken":
        return cls(
            id=token_id or uuid4(),
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
            created_at=created_at,
            used_at=None,
            revoked_at=None,
        )

    def is_expired(self, now: datetime) -> bool:
        return require_aware_datetime(now, "now") >= self.expires_at

    def mark_used(self, now: datetime) -> "PasswordResetToken":
        timestamp = require_aware_datetime(now, "now")
        if self.used_at is not None:
            raise DomainValidationError("password reset token is already used")
        if self.revoked_at is not None:
            raise DomainValidationError("revoked password reset token cannot be used")
        if timestamp < self.created_at:
            raise DomainValidationError("used_at must not be before created_at")
        return replace(self, used_at=timestamp)

    def revoke(self, now: datetime) -> "PasswordResetToken":
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("revoked_at must not be before created_at")
        if self.used_at is not None or self.revoked_at is not None:
            return self
        return replace(self, revoked_at=timestamp)
