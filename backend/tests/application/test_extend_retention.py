"""Existing retention extension remains monotonic and media-safe."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from messenger.application.messaging.extend_retention import ExtendExistingRetention
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.domain.entities import (
    Attachment,
    AttachmentMediaKind,
    Message,
    MessageDeletionReason,
)
from messenger.domain.entities.attachment import digest_attachment_bytes
from tests.application.fakes import FakeMessagingUnitOfWorkFactory, IdentityState

NOW = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)
YEAR = timedelta(days=365)


def create_message(*, retention: timedelta, sequence: int) -> Message:
    return Message.create(
        conversation_id=uuid4(),
        client_message_id=uuid4(),
        sender_user_id=uuid4(),
        sender_device_id=uuid4(),
        protocol_version=1,
        sequence=sequence,
        ciphertext=f"opaque-{sequence}".encode(),
        now=NOW,
        retention=retention,
    )


def create_attachment(message: Message | None, *, retention: timedelta) -> Attachment:
    body = b"opaque-media"
    pending = Attachment.create_pending(
        client_attachment_id=uuid4(),
        conversation_id=message.conversation_id if message is not None else uuid4(),
        uploader_user_id=uuid4(),
        uploader_device_id=uuid4(),
        storage_key=f"ab/{uuid4().hex}",
        media_kind=AttachmentMediaKind.FILE,
        byte_size=len(body),
        sha256_digest=digest_attachment_bytes(body),
        content_type="application/octet-stream",
        now=NOW,
        pending_retention=retention,
    )
    return (
        pending.commit_to_message(message.id, pending.expires_at)
        if message is not None
        else pending
    )


async def test_existing_retention_extension_is_monotonic_and_idempotent() -> None:
    short = create_message(retention=timedelta(days=30), sequence=1)
    already_long = create_message(retention=timedelta(days=400), sequence=2)
    deleted = create_message(retention=timedelta(days=30), sequence=3).to_tombstone(
        now=NOW + timedelta(days=1),
        tombstone_retention=timedelta(days=730),
        reason=MessageDeletionReason.EXPIRED,
        deleted_by_user_id=None,
    )
    committed = create_attachment(short, retention=timedelta(days=30))
    long_committed = create_attachment(already_long, retention=timedelta(days=400))
    deleted_committed = create_attachment(deleted, retention=timedelta(days=30))
    pending = create_attachment(None, retention=timedelta(days=1))
    state = IdentityState(
        messages={message.id: message for message in (short, already_long, deleted)},
        attachments={
            item.id: item for item in (committed, long_committed, deleted_committed, pending)
        },
    )
    use_case = ExtendExistingRetention(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        retention_policy=MessageRetentionPolicy(YEAR, timedelta(days=730)),
    )

    first = await use_case.execute()

    assert first.extended_messages == 1
    assert first.extended_attachments == 1
    assert state.messages[short.id].expires_at == NOW + YEAR
    assert state.messages[already_long.id].expires_at == already_long.expires_at
    assert state.messages[deleted.id].expires_at == deleted.expires_at
    assert state.attachments[committed.id].expires_at == NOW + YEAR
    assert state.attachments[long_committed.id].expires_at == long_committed.expires_at
    assert state.attachments[deleted_committed.id].expires_at == deleted_committed.expires_at
    assert state.attachments[pending.id].expires_at == pending.expires_at
    assert state.commits == 1

    repeated = await use_case.execute()

    assert repeated.extended_messages == 0
    assert repeated.extended_attachments == 0
    assert state.commits == 1
