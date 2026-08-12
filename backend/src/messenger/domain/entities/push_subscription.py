"""Device-bound Web Push subscription."""

from __future__ import annotations

from base64 import urlsafe_b64decode
from dataclasses import dataclass, replace
from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError


def _decode_key(value: str, *, field_name: str, expected_bytes: int) -> bytes:
    if not value or len(value) > 256 or any(character.isspace() for character in value):
        raise DomainValidationError(f"{field_name} is invalid")
    try:
        decoded = urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except ValueError as error:
        raise DomainValidationError(f"{field_name} is invalid") from error
    if len(decoded) != expected_bytes:
        raise DomainValidationError(f"{field_name} has invalid length")
    return decoded


def validate_push_endpoint(value: str) -> str:
    if not value or len(value) > 2048 or value != value.strip():
        raise DomainValidationError("push endpoint is invalid")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or not parsed.path
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise DomainValidationError("push endpoint must be an HTTPS URL")
    return value


@dataclass(frozen=True, slots=True)
class PushSubscription:
    """Opaque browser push material scoped to one active device."""

    id: UUID
    user_id: UUID
    device_id: UUID
    endpoint: str
    p256dh: str
    auth: str
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        validate_push_endpoint(self.endpoint)
        public_key = _decode_key(self.p256dh, field_name="p256dh", expected_bytes=65)
        if public_key[0] != 4:
            raise DomainValidationError("p256dh must be an uncompressed P-256 key")
        _decode_key(self.auth, field_name="auth", expected_bytes=16)
        require_aware_datetime(self.created_at, "created_at")
        require_aware_datetime(self.updated_at, "updated_at")
        if self.updated_at < self.created_at:
            raise DomainValidationError("updated_at must not be before created_at")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        device_id: UUID,
        endpoint: str,
        p256dh: str,
        auth: str,
        now: datetime,
    ) -> PushSubscription:
        timestamp = require_aware_datetime(now, "now")
        return cls(
            id=uuid4(),
            user_id=user_id,
            device_id=device_id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            created_at=timestamp,
            updated_at=timestamp,
        )

    def refresh(self, *, endpoint: str, p256dh: str, auth: str, now: datetime) -> PushSubscription:
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("updated_at must not be before created_at")
        return replace(
            self,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            updated_at=timestamp,
        )
