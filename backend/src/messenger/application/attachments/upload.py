"""Authorize and persist one server-readable group attachment upload."""

from collections.abc import AsyncIterable
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.attachments.policy import AttachmentPolicy
from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import (
    AttachmentConflictError,
    AttachmentTooLargeError,
    AuthorizationDeniedError,
    InvalidAttachmentError,
)
from messenger.application.ports.attachments import AttachmentUnitOfWorkFactory
from messenger.application.ports.clock import Clock
from messenger.application.ports.media_storage import (
    MediaIntegrityError,
    MediaStorage,
    MediaTooLargeError,
)
from messenger.domain.entities import Attachment, AttachmentMediaKind, ConversationType


@dataclass(frozen=True, slots=True)
class UploadGroupAttachmentCommand:
    actor_user_id: UUID
    actor_device_id: UUID
    conversation_id: UUID
    client_attachment_id: UUID
    media_kind: AttachmentMediaKind
    byte_size: int
    sha256_digest: str
    content_type: str
    chunks: AsyncIterable[bytes]


@dataclass(frozen=True, slots=True)
class UploadGroupAttachmentResult:
    attachment_id: UUID
    client_attachment_id: UUID
    conversation_id: UUID
    media_kind: AttachmentMediaKind
    byte_size: int
    sha256_digest: str
    content_type: str
    created_at: datetime
    expires_at: datetime


class UploadGroupAttachment:
    def __init__(
        self,
        *,
        unit_of_work: AttachmentUnitOfWorkFactory,
        media_storage: MediaStorage,
        clock: Clock,
        policy: AttachmentPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._media_storage = media_storage
        self._clock = clock
        self._policy = policy

    async def execute(
        self,
        command: UploadGroupAttachmentCommand,
    ) -> UploadGroupAttachmentResult:
        maximum = self._policy.validate_upload(
            media_kind=command.media_kind,
            byte_size=command.byte_size,
            sha256_digest=command.sha256_digest,
            content_type=command.content_type,
        )
        storage_key: str | None = None
        async with self._unit_of_work() as uow:
            await require_active_actor(uow.users, command.actor_user_id)
            device = await uow.devices.get_owned_by_id(
                user_id=command.actor_user_id,
                device_id=command.actor_device_id,
            )
            if device is None or device.revoked_at is not None:
                raise AuthorizationDeniedError("active owned uploader device required")
            conversation, _ = require_active_membership(
                await uow.conversations.get_by_id(command.conversation_id),
                command.actor_user_id,
            )
            if conversation.conversation_type is not ConversationType.GROUP:
                raise InvalidAttachmentError("attachments are available only in group v1")
            existing = await uow.attachments.get_by_client_id(
                uploader_device_id=command.actor_device_id,
                client_attachment_id=command.client_attachment_id,
            )
            if existing is not None:
                if not existing.matches_upload(
                    conversation_id=command.conversation_id,
                    media_kind=command.media_kind,
                    byte_size=command.byte_size,
                    sha256_digest=command.sha256_digest,
                    content_type=command.content_type,
                ):
                    raise AttachmentConflictError("client attachment id conflict")
                return result_from(existing)

            storage_key = self._media_storage.new_storage_key()
            try:
                stored = await self._media_storage.save(
                    storage_key,
                    command.chunks,
                    expected_size=command.byte_size,
                    expected_sha256_hex=command.sha256_digest,
                    max_bytes=maximum,
                )
            except MediaTooLargeError as error:
                raise AttachmentTooLargeError("attachment is too large") from error
            except MediaIntegrityError as error:
                raise InvalidAttachmentError("attachment integrity mismatch") from error
            try:
                await uow.users.get_by_id(command.actor_user_id, for_update=True)
                concurrent = await uow.attachments.get_by_client_id(
                    uploader_device_id=command.actor_device_id,
                    client_attachment_id=command.client_attachment_id,
                    for_update=True,
                )
                if concurrent is not None:
                    if not concurrent.matches_upload(
                        conversation_id=command.conversation_id,
                        media_kind=command.media_kind,
                        byte_size=command.byte_size,
                        sha256_digest=command.sha256_digest,
                        content_type=command.content_type,
                    ):
                        raise AttachmentConflictError("client attachment id conflict")
                    await self._media_storage.delete(storage_key)
                    return result_from(concurrent)
                now = self._clock.now()
                active_bytes = await uow.attachments.active_bytes_for_user(
                    user_id=command.actor_user_id,
                    now=now,
                )
                self._policy.validate_quota(
                    current_bytes=active_bytes,
                    incoming_bytes=stored.size,
                )
                attachment = Attachment.create_pending(
                    client_attachment_id=command.client_attachment_id,
                    conversation_id=command.conversation_id,
                    uploader_user_id=command.actor_user_id,
                    uploader_device_id=command.actor_device_id,
                    storage_key=storage_key,
                    media_kind=command.media_kind,
                    byte_size=stored.size,
                    sha256_digest=stored.sha256_hex,
                    content_type=command.content_type,
                    now=now,
                    pending_retention=self._policy.pending_retention,
                )
                await uow.attachments.add(attachment)
                await uow.commit()
            except BaseException:
                await self._media_storage.delete(storage_key)
                raise
        return result_from(attachment)


def result_from(attachment: Attachment) -> UploadGroupAttachmentResult:
    return UploadGroupAttachmentResult(
        attachment_id=attachment.id,
        client_attachment_id=attachment.client_attachment_id,
        conversation_id=attachment.conversation_id,
        media_kind=attachment.media_kind,
        byte_size=attachment.byte_size,
        sha256_digest=attachment.sha256_digest,
        content_type=attachment.content_type,
        created_at=attachment.created_at,
        expires_at=attachment.expires_at,
    )
