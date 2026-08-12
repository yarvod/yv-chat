"""Bounded group attachment admission, quota and retention policy."""

from dataclasses import dataclass
from datetime import timedelta

from messenger.application.errors import AttachmentTooLargeError, InvalidAttachmentError
from messenger.domain.entities import AttachmentMediaKind

SAFE_IMAGE_CONTENT_TYPES = frozenset(
    {"image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"}
)
SAFE_VIDEO_CONTENT_TYPES = frozenset(
    {"video/mp4", "video/ogg", "video/quicktime", "video/webm", "video/x-m4v"}
)


@dataclass(frozen=True, slots=True)
class AttachmentPolicy:
    image_max_bytes: int = 12 * 1024 * 1024
    video_max_bytes: int = 100 * 1024 * 1024
    file_max_bytes: int = 25 * 1024 * 1024
    user_quota_bytes: int = 5 * 1024 * 1024 * 1024
    pending_retention: timedelta = timedelta(hours=24)
    cleanup_batch_size: int = 100
    max_attachments_per_message: int = 10

    def __post_init__(self) -> None:
        if self.image_max_bytes <= 0:
            raise ValueError("image attachment limit must be positive")
        if self.video_max_bytes <= 0:
            raise ValueError("video attachment limit must be positive")
        if self.file_max_bytes <= 0:
            raise ValueError("file attachment limit must be positive")
        if self.user_quota_bytes < max(
            self.image_max_bytes,
            self.video_max_bytes,
            self.file_max_bytes,
        ):
            raise ValueError("user media quota must fit one maximum attachment")
        if self.pending_retention <= timedelta(0):
            raise ValueError("pending attachment retention must be positive")
        if not 1 <= self.cleanup_batch_size <= 1_000:
            raise ValueError("attachment cleanup batch size is out of range")
        if not 1 <= self.max_attachments_per_message <= 20:
            raise ValueError("attachment count limit is out of range")

    def maximum_bytes(self, media_kind: AttachmentMediaKind) -> int:
        if media_kind is AttachmentMediaKind.IMAGE:
            return self.image_max_bytes
        if media_kind is AttachmentMediaKind.VIDEO:
            return self.video_max_bytes
        return self.file_max_bytes

    def validate_upload(
        self,
        *,
        media_kind: AttachmentMediaKind,
        byte_size: int,
        sha256_digest: str,
        content_type: str,
    ) -> int:
        if byte_size <= 0:
            raise InvalidAttachmentError("attachment is empty")
        maximum = self.maximum_bytes(media_kind)
        if byte_size > maximum:
            raise AttachmentTooLargeError("attachment exceeds configured limit")
        if (
            len(sha256_digest) != 64
            or sha256_digest != sha256_digest.lower()
            or any(character not in "0123456789abcdef" for character in sha256_digest)
        ):
            raise InvalidAttachmentError("invalid attachment digest")
        if not content_type or len(content_type) > 100 or "/" not in content_type:
            raise InvalidAttachmentError("invalid attachment content type")
        if any(
            character.isspace() or ord(character) < 33 or ord(character) > 126
            for character in content_type
        ):
            raise InvalidAttachmentError("invalid attachment content type")
        if media_kind is AttachmentMediaKind.IMAGE and content_type not in SAFE_IMAGE_CONTENT_TYPES:
            raise InvalidAttachmentError("image content type is not supported")
        if media_kind is AttachmentMediaKind.VIDEO and content_type not in SAFE_VIDEO_CONTENT_TYPES:
            raise InvalidAttachmentError("video content type is not supported")
        return maximum

    def validate_quota(self, *, current_bytes: int, incoming_bytes: int) -> None:
        if current_bytes < 0 or incoming_bytes <= 0:
            raise InvalidAttachmentError("invalid media quota accounting")
        if current_bytes + incoming_bytes > self.user_quota_bytes:
            raise AttachmentTooLargeError("user media quota exceeded")

    def validate_message_attachments(self, attachment_ids: tuple[object, ...]) -> None:
        if len(attachment_ids) > self.max_attachments_per_message:
            raise InvalidAttachmentError("message attachment count exceeds configured limit")
        if len(set(attachment_ids)) != len(attachment_ids):
            raise InvalidAttachmentError("message attachment ids must be unique")
