"""Device domain entity."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from messenger.domain.entities._validation import (
    normalize_bounded_text,
    require_aware_datetime,
)
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class Device:
    """A single browser profile or physical device owned by a user."""

    id: UUID
    user_id: UUID
    name: str
    created_at: datetime
    last_seen_at: datetime
    revoked_at: datetime | None

    def __post_init__(self) -> None:
        """Keep loaded and newly created entities equally valid."""
        normalized_name = normalize_bounded_text(
            self.name,
            field_name="name",
            maximum_length=80,
        )
        if self.name != normalized_name:
            raise DomainValidationError("name must be trimmed")

        require_aware_datetime(self.created_at, "created_at")
        require_aware_datetime(self.last_seen_at, "last_seen_at")
        if self.last_seen_at < self.created_at:
            raise DomainValidationError("last_seen_at must not be before created_at")
        if self.revoked_at is not None:
            require_aware_datetime(self.revoked_at, "revoked_at")
            if self.revoked_at < self.created_at:
                raise DomainValidationError("revoked_at must not be before created_at")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        name: str,
        now: datetime,
        device_id: UUID | None = None,
    ) -> "Device":
        """Create an active device for an existing user identity."""
        normalized_name = normalize_bounded_text(
            name,
            field_name="name",
            maximum_length=80,
        )
        timestamp = require_aware_datetime(now, "now")

        return cls(
            id=device_id or uuid4(),
            user_id=user_id,
            name=normalized_name,
            created_at=timestamp,
            last_seen_at=timestamp,
            revoked_at=None,
        )
