"""Bounded idempotent cleanup of orphaned or expired group media."""

from dataclasses import dataclass

from messenger.application.attachments.policy import AttachmentPolicy
from messenger.application.ports.attachments import AttachmentUnitOfWorkFactory
from messenger.application.ports.clock import Clock
from messenger.application.ports.media_storage import MediaStorage


@dataclass(frozen=True, slots=True)
class CleanupExpiredAttachmentsResult:
    deleted_attachments: int


class CleanupExpiredAttachments:
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

    async def execute(self) -> CleanupExpiredAttachmentsResult:
        async with self._unit_of_work() as uow:
            expired = await uow.attachments.list_expired(
                now=self._clock.now(),
                limit=self._policy.cleanup_batch_size,
            )
            for attachment in expired:
                await self._media_storage.delete(attachment.storage_key)
                await uow.attachments.delete(attachment.id)
            if expired:
                await uow.commit()
        return CleanupExpiredAttachmentsResult(deleted_attachments=len(expired))
