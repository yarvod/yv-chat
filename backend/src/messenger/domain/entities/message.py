"""Opaque server-side message envelope without plaintext semantics."""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from hashlib import sha256
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError


class MessageDeletionReason(StrEnum):
    MANUAL = "manual"
    EXPIRED = "expired"


def digest_ciphertext(ciphertext: bytes) -> str:
    return sha256(ciphertext).hexdigest()


@dataclass(frozen=True, slots=True)
class Message:
    id: UUID
    client_message_id: UUID
    conversation_id: UUID
    sender_user_id: UUID
    sender_device_id: UUID
    protocol_version: int
    sequence: int
    ciphertext: bytes | None
    ciphertext_digest: str
    created_at: datetime
    expires_at: datetime
    crypto_generation_id: UUID | None = None
    crypto_epoch: int | None = None
    deletion_reason: MessageDeletionReason | None = None
    deleted_at: datetime | None = None
    deleted_by_user_id: UUID | None = None
    tombstone_expires_at: datetime | None = None

    def __post_init__(self) -> None:
        if self.protocol_version <= 0:
            raise DomainValidationError("protocol_version must be positive")
        if self.protocol_version == 2:
            if (
                self.crypto_generation_id is None
                or self.crypto_epoch is None
                or self.crypto_epoch <= 0
            ):
                raise DomainValidationError("MLS message requires generation and positive epoch")
        elif self.crypto_generation_id is not None or self.crypto_epoch is not None:
            raise DomainValidationError("non-MLS message cannot bind an MLS generation")
        if self.sequence <= 0:
            raise DomainValidationError("sequence must be positive")
        if (
            len(self.ciphertext_digest) != 64
            or self.ciphertext_digest != self.ciphertext_digest.lower()
            or any(character not in "0123456789abcdef" for character in self.ciphertext_digest)
        ):
            raise DomainValidationError("ciphertext_digest must be lowercase SHA-256 hex")
        created_at = require_aware_datetime(self.created_at, "created_at")
        expires_at = require_aware_datetime(self.expires_at, "expires_at")
        if expires_at <= created_at:
            raise DomainValidationError("expires_at must be after created_at")
        tombstone_fields = (
            self.deletion_reason,
            self.deleted_at,
            self.tombstone_expires_at,
        )
        if self.ciphertext is not None:
            if not isinstance(self.ciphertext, bytes) or not self.ciphertext:
                raise DomainValidationError("ciphertext must be non-empty opaque bytes")
            if self.ciphertext_digest != digest_ciphertext(self.ciphertext):
                raise DomainValidationError("ciphertext digest does not match opaque bytes")
            if any(value is not None for value in tombstone_fields) or (
                self.deleted_by_user_id is not None
            ):
                raise DomainValidationError("active message cannot contain tombstone metadata")
            return
        if (
            self.deletion_reason is None
            or self.deleted_at is None
            or self.tombstone_expires_at is None
        ):
            raise DomainValidationError("deleted message requires complete tombstone metadata")
        deleted_at = require_aware_datetime(self.deleted_at, "deleted_at")
        tombstone_expires_at = require_aware_datetime(
            self.tombstone_expires_at, "tombstone_expires_at"
        )
        if deleted_at < created_at:
            raise DomainValidationError("deleted_at must not precede created_at")
        if tombstone_expires_at <= deleted_at:
            raise DomainValidationError("tombstone expiry must follow deletion")
        if self.deletion_reason is MessageDeletionReason.MANUAL:
            if self.deleted_by_user_id is None:
                raise DomainValidationError("manual deletion requires an actor")
        elif self.deleted_by_user_id is not None:
            raise DomainValidationError("automatic expiry cannot have a deletion actor")

    @classmethod
    def create(
        cls,
        *,
        conversation_id: UUID,
        client_message_id: UUID,
        sender_user_id: UUID,
        sender_device_id: UUID,
        protocol_version: int,
        sequence: int,
        ciphertext: bytes,
        now: datetime,
        retention: timedelta,
        crypto_generation_id: UUID | None = None,
        crypto_epoch: int | None = None,
        message_id: UUID | None = None,
    ) -> "Message":
        timestamp = require_aware_datetime(now, "now")
        if retention <= timedelta(0):
            raise DomainValidationError("retention must be positive")
        return cls(
            id=message_id or uuid4(),
            client_message_id=client_message_id,
            conversation_id=conversation_id,
            sender_user_id=sender_user_id,
            sender_device_id=sender_device_id,
            protocol_version=protocol_version,
            sequence=sequence,
            ciphertext=ciphertext,
            ciphertext_digest=digest_ciphertext(ciphertext),
            created_at=timestamp,
            expires_at=timestamp + retention,
            crypto_generation_id=crypto_generation_id,
            crypto_epoch=crypto_epoch,
        )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def to_tombstone(
        self,
        *,
        now: datetime,
        tombstone_retention: timedelta,
        reason: MessageDeletionReason,
        deleted_by_user_id: UUID | None,
    ) -> "Message":
        if self.is_deleted:
            return self
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.created_at:
            raise DomainValidationError("deleted_at must not precede created_at")
        if tombstone_retention <= timedelta(0):
            raise DomainValidationError("tombstone retention must be positive")
        return replace(
            self,
            ciphertext=None,
            deletion_reason=reason,
            deleted_at=timestamp,
            deleted_by_user_id=deleted_by_user_id,
            tombstone_expires_at=timestamp + tombstone_retention,
        )
