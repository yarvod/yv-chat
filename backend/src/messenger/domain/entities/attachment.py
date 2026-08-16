"""Opaque storage metadata for one bounded attachment blob."""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from hashlib import sha256
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError


class AttachmentMediaKind(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    FILE = "file"


def validate_sha256_hex(value: str) -> None:
    if (
        len(value) != 64
        or value != value.lower()
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise DomainValidationError("ciphertext digest must be lowercase SHA-256 hex")


@dataclass(frozen=True, slots=True)
class Attachment:
    id: UUID
    client_attachment_id: UUID
    conversation_id: UUID
    uploader_user_id: UUID
    uploader_device_id: UUID
    storage_key: str
    media_kind: AttachmentMediaKind
    byte_size: int
    sha256_digest: str
    content_type: str
    created_at: datetime
    expires_at: datetime
    committed_message_id: UUID | None = None

    def __post_init__(self) -> None:
        if not self.storage_key or len(self.storage_key) > 100:
            raise DomainValidationError("storage key must be bounded")
        if self.byte_size <= 0:
            raise DomainValidationError("attachment size must be positive")
        validate_sha256_hex(self.sha256_digest)
        if (
            not self.content_type
            or len(self.content_type) > 100
            or any(
                character.isspace() or ord(character) < 33 or ord(character) > 126
                for character in self.content_type
            )
            or "/" not in self.content_type
        ):
            raise DomainValidationError("attachment content type must be bounded ASCII MIME")
        created_at = require_aware_datetime(self.created_at, "created_at")
        expires_at = require_aware_datetime(self.expires_at, "expires_at")
        if expires_at <= created_at:
            raise DomainValidationError("attachment expiry must follow creation")

    @classmethod
    def create_pending(
        cls,
        *,
        client_attachment_id: UUID,
        conversation_id: UUID,
        uploader_user_id: UUID,
        uploader_device_id: UUID,
        storage_key: str,
        media_kind: AttachmentMediaKind,
        byte_size: int,
        sha256_digest: str,
        content_type: str,
        now: datetime,
        pending_retention: timedelta,
        attachment_id: UUID | None = None,
    ) -> "Attachment":
        timestamp = require_aware_datetime(now, "now")
        if pending_retention <= timedelta(0):
            raise DomainValidationError("pending retention must be positive")
        return cls(
            id=attachment_id or uuid4(),
            client_attachment_id=client_attachment_id,
            conversation_id=conversation_id,
            uploader_user_id=uploader_user_id,
            uploader_device_id=uploader_device_id,
            storage_key=storage_key,
            media_kind=media_kind,
            byte_size=byte_size,
            sha256_digest=sha256_digest,
            content_type=content_type,
            created_at=timestamp,
            expires_at=timestamp + pending_retention,
        )

    def matches_upload(
        self,
        *,
        conversation_id: UUID,
        media_kind: AttachmentMediaKind,
        byte_size: int,
        sha256_digest: str,
        content_type: str,
    ) -> bool:
        return (
            self.conversation_id == conversation_id
            and self.media_kind is media_kind
            and self.byte_size == byte_size
            and self.sha256_digest == sha256_digest
            and self.content_type == content_type
        )

    def commit_to_message(self, message_id: UUID, expires_at: datetime) -> "Attachment":
        expiry = require_aware_datetime(expires_at, "expires_at")
        if self.committed_message_id is not None and self.committed_message_id != message_id:
            raise DomainValidationError("attachment is already committed to another message")
        if expiry <= self.created_at:
            raise DomainValidationError("committed attachment expiry must follow creation")
        return replace(self, committed_message_id=message_id, expires_at=expiry)


def digest_attachment_bytes(value: bytes) -> str:
    return sha256(value).hexdigest()
