"""Device-bound browser and native push destinations."""

from __future__ import annotations

import re
from base64 import urlsafe_b64decode
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError

_APNS_TOKEN = re.compile(r"^[0-9a-fA-F]{64}$")


class PushProvider(StrEnum):
    WEB = "web"
    APNS = "apns"
    FCM = "fcm"


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


def validate_native_token(provider: PushProvider, value: str) -> str:
    if provider is PushProvider.WEB:
        raise DomainValidationError("web push does not use a native token")
    if not value or len(value) > 4096 or value != value.strip():
        raise DomainValidationError("native push token is invalid")
    if provider is PushProvider.APNS and _APNS_TOKEN.fullmatch(value) is None:
        raise DomainValidationError("APNs token must contain 64 hexadecimal characters")
    if provider is PushProvider.FCM and (len(value) < 32 or any(char.isspace() for char in value)):
        raise DomainValidationError("FCM token is invalid")
    return value


@dataclass(frozen=True, slots=True)
class PushSubscription:
    """One provider destination scoped to one active device."""

    id: UUID
    user_id: UUID
    device_id: UUID
    provider: PushProvider
    endpoint: str | None
    p256dh: str | None
    auth: str | None
    native_token: str | None
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        if self.provider is PushProvider.WEB:
            if self.endpoint is None or self.p256dh is None or self.auth is None:
                raise DomainValidationError("web push material is incomplete")
            if self.native_token is not None:
                raise DomainValidationError("web push cannot contain a native token")
            validate_push_endpoint(self.endpoint)
            public_key = _decode_key(self.p256dh, field_name="p256dh", expected_bytes=65)
            if public_key[0] != 4:
                raise DomainValidationError("p256dh must be an uncompressed P-256 key")
            _decode_key(self.auth, field_name="auth", expected_bytes=16)
        else:
            if self.endpoint is not None or self.p256dh is not None or self.auth is not None:
                raise DomainValidationError("native push cannot contain Web Push material")
            if self.native_token is None:
                raise DomainValidationError("native push token is required")
            validate_native_token(self.provider, self.native_token)
        require_aware_datetime(self.created_at, "created_at")
        require_aware_datetime(self.updated_at, "updated_at")
        if self.updated_at < self.created_at:
            raise DomainValidationError("updated_at must not be before created_at")

    @property
    def destination(self) -> str:
        value = self.endpoint if self.provider is PushProvider.WEB else self.native_token
        if value is None:
            raise RuntimeError("push destination is incomplete")
        return value

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
        """Compatibility constructor for the existing Web Push contract."""
        return cls.create_web(
            user_id=user_id,
            device_id=device_id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            now=now,
        )

    @classmethod
    def create_web(
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
            provider=PushProvider.WEB,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            native_token=None,
            created_at=timestamp,
            updated_at=timestamp,
        )

    @classmethod
    def create_native(
        cls,
        *,
        user_id: UUID,
        device_id: UUID,
        provider: PushProvider,
        token: str,
        now: datetime,
    ) -> PushSubscription:
        timestamp = require_aware_datetime(now, "now")
        return cls(
            id=uuid4(),
            user_id=user_id,
            device_id=device_id,
            provider=provider,
            endpoint=None,
            p256dh=None,
            auth=None,
            native_token=token,
            created_at=timestamp,
            updated_at=timestamp,
        )

    def refresh_web(
        self, *, endpoint: str, p256dh: str, auth: str, now: datetime
    ) -> PushSubscription:
        return self._refresh(
            provider=PushProvider.WEB,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            native_token=None,
            now=now,
        )

    def refresh(self, *, endpoint: str, p256dh: str, auth: str, now: datetime) -> PushSubscription:
        """Compatibility refresh for existing Web Push callers."""
        return self.refresh_web(endpoint=endpoint, p256dh=p256dh, auth=auth, now=now)

    def refresh_native(
        self, *, provider: PushProvider, token: str, now: datetime
    ) -> PushSubscription:
        return self._refresh(
            provider=provider,
            endpoint=None,
            p256dh=None,
            auth=None,
            native_token=token,
            now=now,
        )

    def _refresh(
        self,
        *,
        provider: PushProvider,
        endpoint: str | None,
        p256dh: str | None,
        auth: str | None,
        native_token: str | None,
        now: datetime,
    ) -> PushSubscription:
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("updated_at must not be before created_at")
        return replace(
            self,
            provider=provider,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            native_token=native_token,
            updated_at=timestamp,
        )
