"""Authorize streaming access to one committed group attachment."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import AttachmentNotFoundError
from messenger.application.ports.attachments import AttachmentUnitOfWorkFactory
from messenger.application.ports.clock import Clock
from messenger.application.ports.media_storage import MediaStorage
from messenger.domain.entities import AttachmentMediaKind


@dataclass(frozen=True, slots=True)
class DownloadGroupAttachmentQuery:
    actor_user_id: UUID
    conversation_id: UUID
    attachment_id: UUID


@dataclass(frozen=True, slots=True)
class DownloadGroupAttachmentResult:
    attachment_id: UUID
    media_kind: AttachmentMediaKind
    byte_size: int
    sha256_digest: str
    content_type: str
    chunks: AsyncIterator[bytes]


class DownloadGroupAttachment:
    def __init__(
        self,
        *,
        unit_of_work: AttachmentUnitOfWorkFactory,
        media_storage: MediaStorage,
        clock: Clock,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._media_storage = media_storage
        self._clock = clock

    async def execute(
        self,
        query: DownloadGroupAttachmentQuery,
    ) -> DownloadGroupAttachmentResult:
        async with self._unit_of_work() as uow:
            await require_active_actor(uow.users, query.actor_user_id)
            require_active_membership(
                await uow.conversations.get_by_id(query.conversation_id),
                query.actor_user_id,
            )
            attachment = await uow.attachments.get_by_id(query.attachment_id)
            if (
                attachment is None
                or attachment.conversation_id != query.conversation_id
                or attachment.committed_message_id is None
                or attachment.expires_at <= self._clock.now()
            ):
                raise AttachmentNotFoundError("attachment is unavailable")
            message = await uow.messages.get_by_id(attachment.committed_message_id)
            if message is None or message.is_deleted:
                raise AttachmentNotFoundError("attachment message is unavailable")
            if not await self._media_storage.exists(attachment.storage_key):
                raise AttachmentNotFoundError("attachment bytes are unavailable")
        return DownloadGroupAttachmentResult(
            attachment_id=attachment.id,
            media_kind=attachment.media_kind,
            byte_size=attachment.byte_size,
            sha256_digest=attachment.sha256_digest,
            content_type=attachment.content_type,
            chunks=self._media_storage.open(attachment.storage_key),
        )
