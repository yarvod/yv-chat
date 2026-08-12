"""Group attachment policy, authorization, binding and retention specifications."""

import hashlib
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from messenger.application.attachments.cleanup import CleanupExpiredAttachments
from messenger.application.attachments.download import (
    DownloadGroupAttachment,
    DownloadGroupAttachmentQuery,
)
from messenger.application.attachments.policy import AttachmentPolicy
from messenger.application.attachments.upload import (
    UploadGroupAttachment,
    UploadGroupAttachmentCommand,
)
from messenger.application.errors import (
    AttachmentConflictError,
    AttachmentNotFoundError,
    AttachmentTooLargeError,
    ConversationNotFoundError,
    InvalidAttachmentError,
)
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.messaging.send_message import (
    SendOpaqueMessage,
    SendOpaqueMessageCommand,
)
from messenger.application.sync import SyncPolicy
from messenger.domain.entities import AttachmentMediaKind, Conversation, Device, User
from tests.application.fakes import (
    FakeAttachmentUnitOfWorkFactory,
    FakeMediaStorage,
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)


async def chunks(body: bytes) -> AsyncIterator[bytes]:
    midpoint = max(1, len(body) // 2)
    yield body[:midpoint]
    yield body[midpoint:]


def attachment_state() -> tuple[IdentityState, User, User, User, Device, Conversation]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    mallory = User.create(username="mallory", display_name="Mallory", now=NOW)
    device = Device.create(user_id=alice.id, name="Alice browser", now=NOW)
    group = Conversation.create_group(created_by=alice.id, title="Team", now=NOW).add_member(
        bob.id, NOW
    )
    state = IdentityState(
        users={item.id: item for item in (alice, bob, mallory)},
        devices={device.id: device},
        conversations={group.id: group},
    )
    return state, alice, bob, mallory, device, group


def upload_command(
    *,
    alice: User,
    device: Device,
    conversation: Conversation,
    body: bytes,
    client_attachment_id: UUID | None = None,
) -> UploadGroupAttachmentCommand:
    return UploadGroupAttachmentCommand(
        actor_user_id=alice.id,
        actor_device_id=device.id,
        conversation_id=conversation.id,
        client_attachment_id=client_attachment_id or uuid4(),
        media_kind=AttachmentMediaKind.IMAGE,
        byte_size=len(body),
        sha256_digest=hashlib.sha256(body).hexdigest(),
        content_type="image/png",
        chunks=chunks(body),
    )


async def test_group_upload_is_idempotent_and_direct_upload_is_rejected() -> None:
    state, alice, bob, _, device, group = attachment_state()
    storage = FakeMediaStorage()
    use_case = UploadGroupAttachment(
        unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
        media_storage=storage,
        clock=FixedClock(NOW),
        policy=AttachmentPolicy(),
    )
    body = b"bounded image bytes"
    command = upload_command(
        alice=alice,
        device=device,
        conversation=group,
        body=body,
    )

    uploaded = await use_case.execute(command)
    retried = await use_case.execute(replace(command, chunks=chunks(body)))

    assert retried == uploaded
    assert len(state.attachments) == 1
    assert list(storage.objects.values()) == [body]

    direct = Conversation.create_direct(created_by=alice.id, other_user_id=bob.id, now=NOW)
    state.conversations[direct.id] = direct
    with pytest.raises(InvalidAttachmentError):
        await use_case.execute(
            upload_command(
                alice=alice,
                device=device,
                conversation=direct,
                body=body,
            )
        )


async def test_quota_integrity_and_client_id_conflicts_remove_partial_objects() -> None:
    state, alice, _, _, device, group = attachment_state()
    storage = FakeMediaStorage()
    policy = AttachmentPolicy(image_max_bytes=32, file_max_bytes=32, user_quota_bytes=32)
    use_case = UploadGroupAttachment(
        unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
        media_storage=storage,
        clock=FixedClock(NOW),
        policy=policy,
    )
    first = upload_command(
        alice=alice,
        device=device,
        conversation=group,
        body=b"a" * 20,
    )
    await use_case.execute(first)

    with pytest.raises(AttachmentTooLargeError):
        await use_case.execute(
            upload_command(
                alice=alice,
                device=device,
                conversation=group,
                body=b"b" * 20,
            )
        )
    assert len(storage.objects) == 1

    with pytest.raises(AttachmentConflictError):
        await use_case.execute(
            upload_command(
                alice=alice,
                device=device,
                conversation=group,
                body=b"different",
                client_attachment_id=first.client_attachment_id,
            )
        )

    strict = UploadGroupAttachment(
        unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
        media_storage=storage,
        clock=FixedClock(NOW),
        policy=AttachmentPolicy(image_max_bytes=4, file_max_bytes=8, user_quota_bytes=8),
    )
    with pytest.raises(AttachmentTooLargeError):
        await strict.execute(
            upload_command(
                alice=alice,
                device=device,
                conversation=group,
                body=b"12345",
            )
        )


async def test_message_binding_download_authorization_and_cleanup() -> None:
    state, alice, _, mallory, device, group = attachment_state()
    storage = FakeMediaStorage()
    policy = AttachmentPolicy(pending_retention=timedelta(hours=1))
    upload = UploadGroupAttachment(
        unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
        media_storage=storage,
        clock=FixedClock(NOW),
        policy=policy,
    )
    body = b"photo"
    uploaded = await upload.execute(
        upload_command(alice=alice, device=device, conversation=group, body=body)
    )
    download = DownloadGroupAttachment(
        unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
        media_storage=storage,
        clock=FixedClock(NOW),
    )
    with pytest.raises(AttachmentNotFoundError):
        await download.execute(
            DownloadGroupAttachmentQuery(alice.id, group.id, uploaded.attachment_id)
        )

    send = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        message_policy=MessageEnvelopePolicy(),
        attachment_policy=policy,
        retention_policy=MessageRetentionPolicy(timedelta(days=30), timedelta(days=90)),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
    )
    sent = await send.execute(
        SendOpaqueMessageCommand(
            actor_user_id=alice.id,
            actor_device_id=device.id,
            conversation_id=group.id,
            client_message_id=uuid4(),
            protocol_version=1,
            ciphertext=b"group attachment envelope",
            attachment_ids=(uploaded.attachment_id,),
        )
    )
    attachment = state.attachments[uploaded.attachment_id]
    assert attachment.committed_message_id == sent.message_id
    assert attachment.expires_at == sent.expires_at == NOW + timedelta(days=30, seconds=1)

    result = await download.execute(
        DownloadGroupAttachmentQuery(alice.id, group.id, uploaded.attachment_id)
    )
    assert b"".join([chunk async for chunk in result.chunks]) == body
    with pytest.raises(ConversationNotFoundError):
        await download.execute(
            DownloadGroupAttachmentQuery(mallory.id, group.id, uploaded.attachment_id)
        )

    state.attachments[uploaded.attachment_id] = replace(
        attachment,
        expires_at=NOW + timedelta(seconds=2),
    )
    storage.objects.clear()
    cleaned = await CleanupExpiredAttachments(
        unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
        media_storage=storage,
        clock=FixedClock(NOW + timedelta(seconds=3)),
        policy=policy,
    ).execute()
    assert cleaned.deleted_attachments == 1
    assert state.attachments == {}
    repeated = await CleanupExpiredAttachments(
        unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
        media_storage=storage,
        clock=FixedClock(NOW + timedelta(seconds=3)),
        policy=policy,
    ).execute()
    assert repeated.deleted_attachments == 0


async def test_message_binding_rejects_another_uploaders_attachment() -> None:
    state, alice, bob, _, alice_device, group = attachment_state()
    bob_device = Device.create(user_id=bob.id, name="Bob browser", now=NOW)
    state.devices[bob_device.id] = bob_device
    policy = AttachmentPolicy()
    uploaded = await UploadGroupAttachment(
        unit_of_work=FakeAttachmentUnitOfWorkFactory(state),
        media_storage=FakeMediaStorage(),
        clock=FixedClock(NOW),
        policy=policy,
    ).execute(
        upload_command(
            alice=bob,
            device=bob_device,
            conversation=group,
            body=b"bob file",
        )
    )

    with pytest.raises(AttachmentConflictError):
        await SendOpaqueMessage(
            unit_of_work=FakeMessagingUnitOfWorkFactory(state),
            clock=FixedClock(NOW),
            message_policy=MessageEnvelopePolicy(),
            attachment_policy=policy,
            retention_policy=MessageRetentionPolicy(timedelta(days=30), timedelta(days=90)),
            sync_policy=SyncPolicy(),
            realtime_notifier=RecordingRealtimeNotifier(),
        ).execute(
            SendOpaqueMessageCommand(
                actor_user_id=alice.id,
                actor_device_id=alice_device.id,
                conversation_id=group.id,
                client_message_id=uuid4(),
                protocol_version=1,
                ciphertext=b"foreign attachment",
                attachment_ids=(uploaded.attachment_id,),
            )
        )
