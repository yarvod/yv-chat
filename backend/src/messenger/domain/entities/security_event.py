"""Bounded, non-secret account security event."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError


class SecurityEventType(StrEnum):
    LOGIN = "login"
    LOGOUT = "logout"
    CREDENTIAL_REPLAY = "credential_replay"
    DEVICE_RENAMED = "device_renamed"
    DEVICE_REVOKED = "device_revoked"
    OTHER_SESSIONS_REVOKED = "other_sessions_revoked"


@dataclass(frozen=True, slots=True)
class SecurityEvent:
    """An auditable account action containing only opaque identifiers."""

    id: UUID
    user_id: UUID
    event_type: SecurityEventType
    created_at: datetime
    expires_at: datetime
    actor_session_id: UUID | None
    target_device_id: UUID | None

    def __post_init__(self) -> None:
        created_at = require_aware_datetime(self.created_at, "created_at")
        expires_at = require_aware_datetime(self.expires_at, "expires_at")
        if expires_at <= created_at:
            raise DomainValidationError("security event expiry must be after creation")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        event_type: SecurityEventType,
        now: datetime,
        retention: timedelta,
        actor_session_id: UUID | None = None,
        target_device_id: UUID | None = None,
        event_id: UUID | None = None,
    ) -> "SecurityEvent":
        timestamp = require_aware_datetime(now, "now")
        if retention <= timedelta(0):
            raise DomainValidationError("security event retention must be positive")
        return cls(
            id=event_id or uuid4(),
            user_id=user_id,
            event_type=event_type,
            created_at=timestamp,
            expires_at=timestamp + retention,
            actor_session_id=actor_session_id,
            target_device_id=target_device_id,
        )
