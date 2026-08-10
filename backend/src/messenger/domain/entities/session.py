"""Revocable device-bound opaque authentication session."""

import re
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError

SESSION_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def _validate_hash(value: str, field_name: str) -> None:
    if SESSION_HASH_PATTERN.fullmatch(value) is None:
        raise DomainValidationError(f"{field_name} must be a lowercase SHA-256 digest")


@dataclass(frozen=True, slots=True)
class Session:
    """Server-side state for one opaque browser session."""

    id: UUID
    user_id: UUID
    device_id: UUID
    current_token_hash: str
    previous_token_hash: str | None
    previous_token_expires_at: datetime | None
    created_at: datetime
    last_seen_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    rotated_at: datetime
    revoked_at: datetime | None

    def __post_init__(self) -> None:
        _validate_hash(self.current_token_hash, "current_token_hash")
        timestamps = {
            "created_at": self.created_at,
            "last_seen_at": self.last_seen_at,
            "idle_expires_at": self.idle_expires_at,
            "absolute_expires_at": self.absolute_expires_at,
            "rotated_at": self.rotated_at,
        }
        for name, value in timestamps.items():
            require_aware_datetime(value, name)
        if self.last_seen_at < self.created_at:
            raise DomainValidationError("last_seen_at must not be before created_at")
        if self.rotated_at < self.created_at:
            raise DomainValidationError("rotated_at must not be before created_at")
        if self.idle_expires_at <= self.last_seen_at:
            raise DomainValidationError("idle_expires_at must be after last_seen_at")
        if self.absolute_expires_at <= self.created_at:
            raise DomainValidationError("absolute_expires_at must be after created_at")
        if self.idle_expires_at > self.absolute_expires_at:
            raise DomainValidationError("idle_expires_at must not exceed absolute_expires_at")
        previous_pair = self.previous_token_hash, self.previous_token_expires_at
        if (previous_pair[0] is None) != (previous_pair[1] is None):
            raise DomainValidationError("previous token hash and expiry must be set together")
        if self.previous_token_hash is not None:
            _validate_hash(self.previous_token_hash, "previous_token_hash")
            if self.previous_token_hash == self.current_token_hash:
                raise DomainValidationError("current and previous token hashes must differ")
            if self.previous_token_expires_at is None:
                raise DomainValidationError("previous token expiry is required")
            previous_expiry = require_aware_datetime(
                self.previous_token_expires_at,
                "previous_token_expires_at",
            )
            if previous_expiry <= self.rotated_at:
                raise DomainValidationError("previous token expiry must be after rotated_at")
        if self.revoked_at is not None:
            require_aware_datetime(self.revoked_at, "revoked_at")
            if self.revoked_at < self.created_at:
                raise DomainValidationError("revoked_at must not be before created_at")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        device_id: UUID,
        token_hash: str,
        now: datetime,
        idle_timeout: timedelta,
        absolute_lifetime: timedelta,
        session_id: UUID | None = None,
    ) -> "Session":
        """Create one active session with bounded idle and absolute expiry."""
        timestamp = require_aware_datetime(now, "now")
        absolute_expires_at = timestamp + absolute_lifetime
        return cls(
            id=session_id or uuid4(),
            user_id=user_id,
            device_id=device_id,
            current_token_hash=token_hash,
            previous_token_hash=None,
            previous_token_expires_at=None,
            created_at=timestamp,
            last_seen_at=timestamp,
            idle_expires_at=min(timestamp + idle_timeout, absolute_expires_at),
            absolute_expires_at=absolute_expires_at,
            rotated_at=timestamp,
            revoked_at=None,
        )

    def is_expired(self, now: datetime) -> bool:
        timestamp = require_aware_datetime(now, "now")
        return timestamp >= self.idle_expires_at or timestamp >= self.absolute_expires_at

    def previous_token_is_valid(self, now: datetime) -> bool:
        if self.previous_token_expires_at is None:
            return False
        return require_aware_datetime(now, "now") < self.previous_token_expires_at

    def rotation_is_due(self, now: datetime, interval: timedelta) -> bool:
        return require_aware_datetime(now, "now") >= self.rotated_at + interval

    def touch_is_due(self, now: datetime, interval: timedelta) -> bool:
        return require_aware_datetime(now, "now") >= self.last_seen_at + interval

    def touch(self, now: datetime, idle_timeout: timedelta) -> "Session":
        timestamp = require_aware_datetime(now, "now")
        if self.revoked_at is not None or self.is_expired(timestamp):
            raise DomainValidationError("inactive session cannot be touched")
        return replace(
            self,
            last_seen_at=timestamp,
            idle_expires_at=min(timestamp + idle_timeout, self.absolute_expires_at),
        )

    def rotate(
        self,
        *,
        new_token_hash: str,
        now: datetime,
        previous_token_grace: timedelta,
    ) -> "Session":
        timestamp = require_aware_datetime(now, "now")
        if self.revoked_at is not None or self.is_expired(timestamp):
            raise DomainValidationError("inactive session cannot be rotated")
        return replace(
            self,
            current_token_hash=new_token_hash,
            previous_token_hash=self.current_token_hash,
            previous_token_expires_at=timestamp + previous_token_grace,
            rotated_at=timestamp,
        )

    def revoke(self, now: datetime) -> "Session":
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("revoked_at must not be before created_at")
        if self.revoked_at is not None:
            return self
        return replace(self, revoked_at=timestamp)
