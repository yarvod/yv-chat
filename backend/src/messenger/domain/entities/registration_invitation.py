"""Standalone administrator-issued registration invitation."""

from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4

from messenger.domain.entities._validation import normalize_bounded_text, require_aware_datetime
from messenger.domain.entities.activation_token import TOKEN_HASH_PATTERN
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class RegistrationInvitation:
    """One-time credential that creates a user only when redeemed."""

    id: UUID
    token_hash: str
    label: str | None
    created_by_user_id: UUID
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None = None
    revoked_at: datetime | None = None
    registered_user_id: UUID | None = None

    def __post_init__(self) -> None:
        if TOKEN_HASH_PATTERN.fullmatch(self.token_hash) is None:
            raise DomainValidationError("token_hash must be a lowercase SHA-256 digest")
        if self.label is not None:
            normalized = normalize_bounded_text(
                self.label,
                field_name="label",
                maximum_length=80,
            )
            if self.label != normalized:
                raise DomainValidationError("label must be trimmed")
        require_aware_datetime(self.created_at, "created_at")
        require_aware_datetime(self.expires_at, "expires_at")
        if self.expires_at <= self.created_at:
            raise DomainValidationError("expires_at must be after created_at")
        if self.used_at is not None:
            require_aware_datetime(self.used_at, "used_at")
            if self.used_at < self.created_at:
                raise DomainValidationError("used_at must not be before created_at")
        if self.revoked_at is not None:
            require_aware_datetime(self.revoked_at, "revoked_at")
            if self.revoked_at < self.created_at:
                raise DomainValidationError("revoked_at must not be before created_at")
        if self.used_at is not None and self.revoked_at is not None:
            raise DomainValidationError("invitation cannot be used and revoked")
        if (self.used_at is None) != (self.registered_user_id is None):
            raise DomainValidationError("used invitation must reference its registered user")

    @classmethod
    def create(
        cls,
        *,
        token_hash: str,
        label: str | None,
        created_by_user_id: UUID,
        created_at: datetime,
        expires_at: datetime,
        invitation_id: UUID | None = None,
    ) -> "RegistrationInvitation":
        normalized_label = None
        if label is not None and label.strip():
            normalized_label = normalize_bounded_text(
                label,
                field_name="label",
                maximum_length=80,
            )
        return cls(
            id=invitation_id or uuid4(),
            token_hash=token_hash,
            label=normalized_label,
            created_by_user_id=created_by_user_id,
            created_at=created_at,
            expires_at=expires_at,
        )

    def is_expired(self, now: datetime) -> bool:
        return require_aware_datetime(now, "now") >= self.expires_at

    def redeem(self, *, user_id: UUID, now: datetime) -> "RegistrationInvitation":
        timestamp = require_aware_datetime(now, "now")
        if self.used_at is not None or self.revoked_at is not None or self.is_expired(timestamp):
            raise DomainValidationError("invitation cannot be redeemed")
        return replace(self, used_at=timestamp, registered_user_id=user_id)

    def revoke(self, now: datetime) -> "RegistrationInvitation":
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("revoked_at must not be before created_at")
        if self.used_at is not None or self.revoked_at is not None or self.is_expired(timestamp):
            return self
        return replace(self, revoked_at=timestamp)
