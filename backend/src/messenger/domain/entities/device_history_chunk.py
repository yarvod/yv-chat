"""Opaque, TTL-bounded MLS application messages used for device history merge."""

from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class DeviceHistoryChunk:
    id: UUID
    pairing_id: UUID
    sender_device_id: UUID
    target_device_id: UUID
    conversation_id: UUID
    client_chunk_id: UUID
    ciphertext_base64: str
    created_at: datetime
    expires_at: datetime
    server_sequence: int | None = None
    acknowledged_at: datetime | None = None

    def __post_init__(self) -> None:
        created_at = require_aware_datetime(self.created_at, "created_at")
        expires_at = require_aware_datetime(self.expires_at, "expires_at")
        if self.sender_device_id == self.target_device_id:
            raise DomainValidationError("history chunk devices must differ")
        if not self.ciphertext_base64 or len(self.ciphertext_base64) > 700_000:
            raise DomainValidationError("history chunk ciphertext is invalid")
        if expires_at <= created_at:
            raise DomainValidationError("history chunk expiry must follow creation")
        if self.server_sequence is not None and self.server_sequence <= 0:
            raise DomainValidationError("history chunk sequence must be positive")
        if self.acknowledged_at is not None:
            acknowledged_at = require_aware_datetime(self.acknowledged_at, "acknowledged_at")
            if acknowledged_at < created_at:
                raise DomainValidationError("history chunk ACK precedes creation")

    @classmethod
    def create(
        cls,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        target_device_id: UUID,
        conversation_id: UUID,
        client_chunk_id: UUID,
        ciphertext_base64: str,
        now: datetime,
        expires_at: datetime,
    ) -> "DeviceHistoryChunk":
        return cls(
            id=uuid4(),
            pairing_id=pairing_id,
            sender_device_id=sender_device_id,
            target_device_id=target_device_id,
            conversation_id=conversation_id,
            client_chunk_id=client_chunk_id,
            ciphertext_base64=ciphertext_base64,
            created_at=now,
            expires_at=expires_at,
        )

    def acknowledge(self, now: datetime) -> "DeviceHistoryChunk":
        if self.acknowledged_at is not None:
            return self
        return replace(self, acknowledged_at=require_aware_datetime(now, "now"))
