"""Opaque server-side message envelope without plaintext semantics."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class Message:
    id: UUID
    conversation_id: UUID
    sender_user_id: UUID
    sender_device_id: UUID
    protocol_version: int
    ciphertext: bytes
    created_at: datetime

    def __post_init__(self) -> None:
        if self.protocol_version <= 0:
            raise DomainValidationError("protocol_version must be positive")
        if not isinstance(self.ciphertext, bytes) or not self.ciphertext:
            raise DomainValidationError("ciphertext must be non-empty opaque bytes")
        require_aware_datetime(self.created_at, "created_at")

    @classmethod
    def create(
        cls,
        *,
        conversation_id: UUID,
        sender_user_id: UUID,
        sender_device_id: UUID,
        protocol_version: int,
        ciphertext: bytes,
        now: datetime,
        message_id: UUID | None = None,
    ) -> "Message":
        return cls(
            id=message_id or uuid4(),
            conversation_id=conversation_id,
            sender_user_id=sender_user_id,
            sender_device_id=sender_device_id,
            protocol_version=protocol_version,
            ciphertext=ciphertext,
            created_at=require_aware_datetime(now, "now"),
        )
