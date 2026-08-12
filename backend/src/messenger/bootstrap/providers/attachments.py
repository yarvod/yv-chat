"""Group attachment policy, storage adapter and use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.attachments import (
    AttachmentPolicy,
    CleanupExpiredAttachments,
    DownloadGroupAttachment,
    UploadGroupAttachment,
)
from messenger.application.ports.media_storage import MediaStorage
from messenger.bootstrap.settings import AppSettings
from messenger.infrastructure.media import LocalMediaStorage


class AttachmentProvider(Provider):
    @provide(scope=Scope.APP)
    def attachment_policy(self, settings: AppSettings) -> AttachmentPolicy:
        return settings.attachment_policy

    @provide(scope=Scope.APP)
    def media_storage(self, settings: AppSettings) -> MediaStorage:
        return LocalMediaStorage(settings.media_root)

    upload_group_attachment = provide(UploadGroupAttachment, scope=Scope.REQUEST)
    download_group_attachment = provide(DownloadGroupAttachment, scope=Scope.REQUEST)
    cleanup_expired_attachments = provide(CleanupExpiredAttachments, scope=Scope.REQUEST)
