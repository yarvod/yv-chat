"""Device domain entity."""

from dataclasses import dataclass, replace
from datetime import datetime
from ipaddress import ip_address
from uuid import UUID, uuid4

from messenger.domain.entities._validation import (
    normalize_bounded_text,
    require_aware_datetime,
)
from messenger.domain.exceptions import DomainValidationError


def normalize_ip(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    try:
        return str(ip_address(value))
    except ValueError as error:
        raise DomainValidationError(f"{field_name} must be a valid IP address") from error


@dataclass(frozen=True, slots=True)
class Device:
    """A single browser profile or physical device owned by a user."""

    id: UUID
    user_id: UUID
    name: str
    created_at: datetime
    last_seen_at: datetime
    revoked_at: datetime | None
    login_ip: str | None = None
    last_ip: str | None = None

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
        for field_name, value in (("login_ip", self.login_ip), ("last_ip", self.last_ip)):
            if value is not None and normalize_ip(value, field_name) != value:
                raise DomainValidationError(f"{field_name} must be a normalized IP address")
        if self.login_ip is None and self.last_ip is not None:
            raise DomainValidationError("last_ip requires login_ip")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        name: str,
        now: datetime,
        client_ip: str | None = None,
        device_id: UUID | None = None,
    ) -> "Device":
        """Create an active device for an existing user identity."""
        normalized_name = normalize_bounded_text(
            name,
            field_name="name",
            maximum_length=80,
        )
        timestamp = require_aware_datetime(now, "now")
        normalized_ip = normalize_ip(client_ip, "client_ip")

        return cls(
            id=device_id or uuid4(),
            user_id=user_id,
            name=normalized_name,
            created_at=timestamp,
            last_seen_at=timestamp,
            revoked_at=None,
            login_ip=normalized_ip,
            last_ip=normalized_ip,
        )

    def seen(self, now: datetime, client_ip: str | None) -> "Device":
        """Update best-effort activity metadata without treating IP as identity."""
        timestamp = require_aware_datetime(now, "now")
        if self.revoked_at is not None:
            raise DomainValidationError("revoked device cannot be updated")
        if timestamp < self.last_seen_at:
            raise DomainValidationError("last_seen_at cannot move backwards")
        normalized_ip = (
            normalize_ip(client_ip, "client_ip") if client_ip is not None else self.last_ip
        )
        return replace(self, last_seen_at=timestamp, last_ip=normalized_ip)

    def rename(self, name: str) -> "Device":
        """Change only the user-visible label, preserving authentication state."""
        normalized_name = normalize_bounded_text(
            name,
            field_name="name",
            maximum_length=80,
        )
        return replace(self, name=normalized_name)

    def revoke(self, now: datetime) -> "Device":
        """Revoke the device without using its metadata as an auth factor."""
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("revoked_at must not be before created_at")
        if self.revoked_at is not None:
            return self
        return replace(self, revoked_at=timestamp)
