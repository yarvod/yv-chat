"""Opaque message send authorization specifications."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.application.attachments.policy import AttachmentPolicy
from messenger.application.conversations.list_conversations import (
    ListConversations,
    ListConversationsQuery,
)
from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationCryptoNotReadyError,
    ConversationNotFoundError,
    InvalidMessageEnvelopeError,
    MessageIdempotencyConflictError,
    MessageNotFoundError,
)
from messenger.application.messaging.get_message import GetMessage, GetMessageQuery
from messenger.application.messaging.list_message_history import (
    ListMessageHistory,
    ListMessageHistoryQuery,
)
from messenger.application.messaging.list_messages import ListMessages, ListMessagesQuery
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.messaging.send_message import (
    SendOpaqueMessage,
    SendOpaqueMessageCommand,
)
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.domain.entities import (
    Conversation,
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    Device,
    DeviceCryptoIdentity,
    Message,
    MessageDeletionReason,
    User,
)
from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from tests.application.fakes import (
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingPushNotifier,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
RETENTION = MessageRetentionPolicy(timedelta(days=30), timedelta(days=90))


def crypto_identity(device: Device, marker: int) -> DeviceCryptoIdentity:
    return DeviceCryptoIdentity.create(
        user_id=device.user_id,
        device_id=device.id,
        credential_identity=expected_credential_identity(device.user_id, device.id),
        signature_public_key=bytes([marker]) * 32,
        now=NOW,
    )


def messaging_state() -> tuple[IdentityState, User, User, User, Device, Conversation]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    charlie = User.create(username="charlie", display_name="Charlie", now=NOW)
    device = Device.create(user_id=alice.id, name="Alice device", now=NOW)
    conversation = Conversation.create_group(
        created_by=alice.id,
        title="Test group",
        now=NOW,
    ).add_member(bob.id, NOW)
    state = IdentityState(
        users={user.id: user for user in (alice, bob, charlie)},
        devices={device.id: device},
        conversations={conversation.id: conversation},
    )
    return state, alice, bob, charlie, device, conversation


async def test_send_persists_only_opaque_envelope_metadata() -> None:
    state, alice, _, charlie, device, conversation = messaging_state()
    newer_empty_conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=charlie.id,
        now=NOW + timedelta(milliseconds=500),
    )
    state.conversations[newer_empty_conversation.id] = newer_empty_conversation
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        message_policy=MessageEnvelopePolicy(),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=RecordingPushNotifier(),
    )
    client_message_id = uuid4()
    command = SendOpaqueMessageCommand(
        alice.id,
        device.id,
        conversation.id,
        client_message_id,
        1,
        b"\x00opaque",
    )
    result = await use_case.execute(command)
    retried = await use_case.execute(command)

    assert retried == result
    assert len(state.messages) == 1
    assert result.sequence == 1
    with pytest.raises(MessageIdempotencyConflictError):
        await use_case.execute(
            SendOpaqueMessageCommand(
                alice.id,
                device.id,
                conversation.id,
                client_message_id,
                1,
                b"different",
            )
        )
    second = await use_case.execute(
        SendOpaqueMessageCommand(
            alice.id,
            device.id,
            conversation.id,
            uuid4(),
            1,
            b"second",
        )
    )

    stored = state.messages[result.message_id]
    assert stored.ciphertext == b"\x00opaque"
    assert stored.created_at == NOW + timedelta(seconds=1)
    assert "ciphertext" not in result.__dataclass_fields__
    assert second.sequence == 2
    assert state.conversations[conversation.id].updated_at == NOW + timedelta(seconds=1)
    listed = await ListConversations(unit_of_work=FakeMessagingUnitOfWorkFactory(state)).execute(
        ListConversationsQuery(alice.id)
    )
    assert [item.conversation_id for item in listed[:2]] == [
        conversation.id,
        newer_empty_conversation.id,
    ]
    assert state.read_states[(alice.id, conversation.id)].last_read_sequence == 2
    assert state.delivery_states[(device.id, conversation.id)].last_delivered_sequence == 2
    assert [event.event_type for event in state.sync_events] == [
        SyncEventType.MESSAGE_CREATED,
        SyncEventType.READ_RECEIPT,
        SyncEventType.DELIVERY_RECEIPT,
        SyncEventType.MESSAGE_CREATED,
        SyncEventType.READ_RECEIPT,
        SyncEventType.DELIVERY_RECEIPT,
        SyncEventType.MESSAGE_CREATED,
        SyncEventType.READ_RECEIPT,
        SyncEventType.DELIVERY_RECEIPT,
        SyncEventType.MESSAGE_CREATED,
        SyncEventType.READ_RECEIPT,
        SyncEventType.DELIVERY_RECEIPT,
    ]
    page = await ListMessages(unit_of_work=FakeMessagingUnitOfWorkFactory(state)).execute(
        ListMessagesQuery(alice.id, conversation.id, after_sequence=1, limit=10)
    )
    assert [message.id for message in page] == [second.message_id]
    get_message = GetMessage(unit_of_work=FakeMessagingUnitOfWorkFactory(state))
    assert (
        await get_message.execute(GetMessageQuery(alice.id, conversation.id, result.message_id))
        == stored
    )
    with pytest.raises(MessageNotFoundError):
        await get_message.execute(GetMessageQuery(alice.id, conversation.id, uuid4()))
    other_conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=charlie.id,
        now=NOW,
    )
    state.conversations[other_conversation.id] = other_conversation
    with pytest.raises(MessageNotFoundError):
        await get_message.execute(
            GetMessageQuery(alice.id, other_conversation.id, result.message_id)
        )
    with pytest.raises(ConversationNotFoundError):
        await get_message.execute(GetMessageQuery(charlie.id, conversation.id, result.message_id))


async def test_conversation_type_enforces_new_protocol_but_preserves_historical_retry() -> None:
    state, alice, bob, _, device, group = messaging_state()
    direct = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=NOW,
    )
    state.conversations[direct.id] = direct
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        message_policy=MessageEnvelopePolicy(),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=RecordingPushNotifier(),
    )

    with pytest.raises(InvalidMessageEnvelopeError, match="direct conversation requires"):
        await use_case.execute(
            SendOpaqueMessageCommand(
                alice.id,
                device.id,
                direct.id,
                uuid4(),
                1,
                b"new-direct-v1-is-forbidden",
            )
        )
    with pytest.raises(InvalidMessageEnvelopeError, match="group conversation requires"):
        await use_case.execute(
            SendOpaqueMessageCommand(
                alice.id,
                device.id,
                group.id,
                uuid4(),
                2,
                b"group-v2-is-disabled",
            )
        )

    historical_id = uuid4()
    historical = Message.create(
        conversation_id=direct.id,
        client_message_id=historical_id,
        sender_user_id=alice.id,
        sender_device_id=device.id,
        protocol_version=1,
        sequence=1,
        ciphertext=b"historical-direct-v1",
        now=NOW,
        retention=RETENTION.ciphertext_retention,
    )
    state.messages[historical.id] = historical
    retried = await use_case.execute(
        SendOpaqueMessageCommand(
            alice.id,
            device.id,
            direct.id,
            historical_id,
            1,
            b"historical-direct-v1",
        )
    )

    assert retried.message_id == historical.id
    assert len(state.messages) == 1


async def test_history_pages_latest_and_before_without_gaps_or_duplicates() -> None:
    state, alice, _, _, device, conversation = messaging_state()
    for sequence in range(1, 206):
        message = Message.create(
            conversation_id=conversation.id,
            client_message_id=uuid4(),
            sender_user_id=alice.id,
            sender_device_id=device.id,
            protocol_version=1,
            sequence=sequence,
            ciphertext=f"opaque-{sequence}".encode(),
            now=NOW + timedelta(seconds=sequence),
            retention=timedelta(days=30),
        )
        state.messages[message.id] = message
    use_case = ListMessageHistory(unit_of_work=FakeMessagingUnitOfWorkFactory(state))

    latest = await use_case.execute(ListMessageHistoryQuery(alice.id, conversation.id, limit=100))
    older = await use_case.execute(
        ListMessageHistoryQuery(
            alice.id,
            conversation.id,
            before_sequence=latest.oldest_sequence,
            limit=100,
        )
    )
    oldest = await use_case.execute(
        ListMessageHistoryQuery(
            alice.id,
            conversation.id,
            before_sequence=older.oldest_sequence,
            limit=100,
        )
    )

    assert [item.sequence for item in latest.messages] == list(range(106, 206))
    assert [item.sequence for item in older.messages] == list(range(6, 106))
    assert [item.sequence for item in oldest.messages] == list(range(1, 6))
    assert latest.has_more is True
    assert older.has_more is True
    assert oldest.has_more is False
    assert latest.oldest_sequence == 106
    assert latest.newest_sequence == 205


async def test_history_rejects_invalid_bounds_and_non_member() -> None:
    state, alice, _, charlie, _, conversation = messaging_state()
    use_case = ListMessageHistory(unit_of_work=FakeMessagingUnitOfWorkFactory(state))
    with pytest.raises(InvalidMessageEnvelopeError):
        await use_case.execute(
            ListMessageHistoryQuery(alice.id, conversation.id, before_sequence=0)
        )
    with pytest.raises(InvalidMessageEnvelopeError):
        await use_case.execute(ListMessageHistoryQuery(alice.id, conversation.id, limit=101))
    with pytest.raises(ConversationNotFoundError):
        await use_case.execute(ListMessageHistoryQuery(charlie.id, conversation.id))


async def test_history_has_more_does_not_assume_contiguous_sequences() -> None:
    state, alice, _, _, device, conversation = messaging_state()
    for sequence in (1, 3, 7):
        message = Message.create(
            conversation_id=conversation.id,
            client_message_id=uuid4(),
            sender_user_id=alice.id,
            sender_device_id=device.id,
            protocol_version=1,
            sequence=sequence,
            ciphertext=f"opaque-{sequence}".encode(),
            now=NOW + timedelta(seconds=sequence),
            retention=timedelta(days=30),
        )
        state.messages[message.id] = message
    use_case = ListMessageHistory(unit_of_work=FakeMessagingUnitOfWorkFactory(state))

    latest = await use_case.execute(ListMessageHistoryQuery(alice.id, conversation.id, limit=2))
    older = await use_case.execute(
        ListMessageHistoryQuery(
            alice.id,
            conversation.id,
            before_sequence=latest.oldest_sequence,
            limit=2,
        )
    )

    assert [item.sequence for item in latest.messages] == [3, 7]
    assert latest.has_more is True
    assert [item.sequence for item in older.messages] == [1]
    assert older.has_more is False


async def test_send_rejects_non_member_and_foreign_or_revoked_device() -> None:
    state, alice, _, charlie, device, conversation = messaging_state()
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        message_policy=MessageEnvelopePolicy(),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=RecordingPushNotifier(),
    )
    charlie_device = Device.create(user_id=charlie.id, name="Charlie device", now=NOW)
    state.devices[charlie_device.id] = charlie_device
    with pytest.raises(ConversationNotFoundError):
        await use_case.execute(
            SendOpaqueMessageCommand(
                charlie.id,
                charlie_device.id,
                conversation.id,
                uuid4(),
                1,
                b"opaque",
            )
        )
    with pytest.raises(AuthorizationDeniedError):
        await use_case.execute(
            SendOpaqueMessageCommand(
                alice.id,
                charlie.id,
                conversation.id,
                uuid4(),
                1,
                b"opaque",
            )
        )
    state.devices[device.id] = device.revoke(NOW + timedelta(seconds=1))
    with pytest.raises(AuthorizationDeniedError):
        await use_case.execute(
            SendOpaqueMessageCommand(
                alice.id,
                device.id,
                conversation.id,
                uuid4(),
                1,
                b"opaque",
            )
        )
    assert state.messages == {}


async def test_send_retry_remains_idempotent_after_ciphertext_is_scrubbed() -> None:
    state, alice, _, _, device, conversation = messaging_state()
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        message_policy=MessageEnvelopePolicy(),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=RecordingPushNotifier(),
    )
    command = SendOpaqueMessageCommand(alice.id, device.id, conversation.id, uuid4(), 1, b"opaque")
    sent = await use_case.execute(command)
    stored = state.messages[sent.message_id]
    state.messages[sent.message_id] = stored.to_tombstone(
        now=NOW + timedelta(minutes=1),
        tombstone_retention=timedelta(days=90),
        reason=MessageDeletionReason.MANUAL,
        deleted_by_user_id=alice.id,
    )

    assert await use_case.execute(command) == sent
    with pytest.raises(MessageIdempotencyConflictError):
        await use_case.execute(
            SendOpaqueMessageCommand(
                alice.id,
                device.id,
                conversation.id,
                command.client_message_id,
                1,
                b"different",
            )
        )
    assert len(state.messages) == 1


async def test_send_rejects_unsupported_empty_and_oversized_envelopes() -> None:
    state, alice, _, _, device, conversation = messaging_state()
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        message_policy=MessageEnvelopePolicy(max_ciphertext_bytes=8),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=RecordingPushNotifier(),
    )
    for version, ciphertext in ((2, b"opaque"), (1, b""), (1, b"x" * 9)):
        with pytest.raises(InvalidMessageEnvelopeError):
            await use_case.execute(
                SendOpaqueMessageCommand(
                    alice.id,
                    device.id,
                    conversation.id,
                    uuid4(),
                    version,
                    ciphertext,
                )
            )
    assert state.messages == {}


async def test_realtime_failure_does_not_rollback_committed_message() -> None:
    state, alice, _, _, device, conversation = messaging_state()
    notifier = RecordingRealtimeNotifier(fail=True)
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        message_policy=MessageEnvelopePolicy(),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=notifier,
        push_notifier=RecordingPushNotifier(),
    )
    result = await use_case.execute(
        SendOpaqueMessageCommand(
            alice.id,
            device.id,
            conversation.id,
            uuid4(),
            1,
            b"opaque",
        )
    )

    assert state.messages[result.message_id].ciphertext == b"opaque"
    assert state.commits == 1


async def test_send_pushes_only_recipient_after_commit_and_isolates_push_failure() -> None:
    state, alice, bob, _, device, conversation = messaging_state()
    notifier = RecordingPushNotifier()
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        message_policy=MessageEnvelopePolicy(),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=notifier,
    )
    result = await use_case.execute(
        SendOpaqueMessageCommand(
            alice.id,
            device.id,
            conversation.id,
            uuid4(),
            1,
            b"opaque",
        )
    )

    assert state.commits == 1
    assert len(notifier.notifications) == 1
    notification = notifier.notifications[0]
    assert notification.user_id == bob.id
    assert notification.conversation_id == conversation.id
    assert notification.message_id == result.message_id

    failing = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=2)),
        message_policy=MessageEnvelopePolicy(),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=RecordingPushNotifier(fail=True),
    )
    second = await failing.execute(
        SendOpaqueMessageCommand(
            alice.id,
            device.id,
            conversation.id,
            uuid4(),
            1,
            b"another-opaque",
        )
    )
    assert state.messages[second.message_id].ciphertext == b"another-opaque"
    assert state.commits == 2


async def test_v2_send_requires_ready_generation_and_sender_leaf() -> None:
    state, alice, bob, _, device, _ = messaging_state()
    bob_device = Device.create(user_id=bob.id, name="Bob device", now=NOW)
    state.devices[bob_device.id] = bob_device
    state.device_crypto_identities = {
        device.id: crypto_identity(device, 1),
        bob_device.id: crypto_identity(bob_device, 2),
    }
    conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=NOW,
    )
    state.conversations[conversation.id] = conversation
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=2)),
        message_policy=MessageEnvelopePolicy(supported_protocol_versions=frozenset({2})),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=RecordingPushNotifier(),
    )
    command = SendOpaqueMessageCommand(
        alice.id,
        device.id,
        conversation.id,
        uuid4(),
        2,
        b"opaque-mls-private-message",
    )
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(command)

    pending = ConversationCryptoGeneration.create(
        conversation_id=conversation.id,
        generation_number=1,
        coordinator_user_id=alice.id,
        coordinator_device_id=device.id,
        bootstrap_request_id=uuid4(),
        now=NOW,
    )
    state.conversation_crypto_generations[pending.id] = pending
    state.conversation_crypto_required_devices[(pending.id, device.id)] = (
        ConversationCryptoRequiredDevice(
            generation_id=pending.id,
            user_id=alice.id,
            device_id=device.id,
            is_coordinator=True,
            key_package_id=None,
            snapshot_at=NOW,
        )
    )
    state.conversation_crypto_required_devices[(pending.id, bob_device.id)] = (
        ConversationCryptoRequiredDevice(
            generation_id=pending.id,
            user_id=bob.id,
            device_id=bob_device.id,
            is_coordinator=False,
            key_package_id=None,
            snapshot_at=NOW,
        )
    )
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(command)

    state.conversation_crypto_generations[pending.id] = pending.finalize(
        epoch=1,
        commit_message=b"opaque-commit",
        ratchet_tree=b"opaque-tree",
        now=NOW + timedelta(seconds=1),
    )
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(replace(command, crypto_generation_id=pending.id, crypto_epoch=2))
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(replace(command, crypto_generation_id=uuid4(), crypto_epoch=1))
    bound_command = replace(
        command,
        crypto_generation_id=pending.id,
        crypto_epoch=1,
    )
    sent = await use_case.execute(bound_command)
    assert sent.protocol_version == 2
    assert state.messages[sent.message_id].ciphertext == b"opaque-mls-private-message"

    next_generation = ConversationCryptoGeneration.create(
        conversation_id=conversation.id,
        generation_number=2,
        coordinator_user_id=alice.id,
        coordinator_device_id=device.id,
        bootstrap_request_id=uuid4(),
        now=NOW + timedelta(seconds=3),
    ).finalize(
        epoch=2,
        commit_message=b"next-opaque-commit",
        ratchet_tree=b"next-opaque-tree",
        now=NOW + timedelta(seconds=4),
    )
    state.conversation_crypto_generations[pending.id] = state.conversation_crypto_generations[
        pending.id
    ].supersede(NOW + timedelta(seconds=3))
    state.conversation_crypto_generations[next_generation.id] = next_generation
    for required in tuple(state.conversation_crypto_required_devices.values()):
        if required.generation_id == pending.id:
            state.conversation_crypto_required_devices[
                (
                    next_generation.id,
                    required.device_id,
                )
            ] = replace(required, generation_id=next_generation.id)
    assert await use_case.execute(bound_command) == sent
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(replace(bound_command, client_message_id=uuid4()))

    new_bob_device = Device.create(user_id=bob.id, name="New Bob device", now=NOW)
    state.devices[new_bob_device.id] = new_bob_device
    state.device_crypto_identities[new_bob_device.id] = crypto_identity(new_bob_device, 3)
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(
            replace(
                bound_command,
                client_message_id=uuid4(),
                crypto_generation_id=next_generation.id,
                crypto_epoch=2,
            )
        )

    state.conversation_crypto_required_devices.clear()
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(
            SendOpaqueMessageCommand(
                alice.id,
                device.id,
                conversation.id,
                uuid4(),
                2,
                b"another-opaque-message",
            )
        )


async def test_v2_send_ignores_active_legacy_device_without_crypto_identity() -> None:
    state, alice, bob, _, alice_device, _ = messaging_state()
    bob_capable = Device.create(user_id=bob.id, name="Bob capable", now=NOW)
    bob_legacy = Device.create(
        user_id=bob.id,
        name="Bob legacy without MLS",
        now=NOW + timedelta(seconds=1),
    )
    state.devices.update({bob_capable.id: bob_capable, bob_legacy.id: bob_legacy})
    state.device_crypto_identities = {
        alice_device.id: crypto_identity(alice_device, 1),
        bob_capable.id: crypto_identity(bob_capable, 2),
    }
    conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=NOW,
    )
    state.conversations[conversation.id] = conversation
    generation = ConversationCryptoGeneration.create(
        conversation_id=conversation.id,
        generation_number=1,
        coordinator_user_id=alice.id,
        coordinator_device_id=alice_device.id,
        bootstrap_request_id=uuid4(),
        now=NOW,
    ).finalize(
        epoch=1,
        commit_message=b"opaque-commit",
        ratchet_tree=b"opaque-tree",
        now=NOW + timedelta(seconds=1),
    )
    state.conversation_crypto_generations[generation.id] = generation
    for device, is_coordinator in ((alice_device, True), (bob_capable, False)):
        state.conversation_crypto_required_devices[(generation.id, device.id)] = (
            ConversationCryptoRequiredDevice(
                generation_id=generation.id,
                user_id=device.user_id,
                device_id=device.id,
                is_coordinator=is_coordinator,
                key_package_id=None,
                snapshot_at=NOW,
            )
        )
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=2)),
        message_policy=MessageEnvelopePolicy(supported_protocol_versions=frozenset({2})),
        attachment_policy=AttachmentPolicy(),
        retention_policy=RETENTION,
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
        push_notifier=RecordingPushNotifier(),
    )
    command = SendOpaqueMessageCommand(
        actor_user_id=alice.id,
        actor_device_id=alice_device.id,
        conversation_id=conversation.id,
        client_message_id=uuid4(),
        protocol_version=2,
        ciphertext=b"opaque-for-offline-capable-leaf",
        crypto_generation_id=generation.id,
        crypto_epoch=1,
    )

    sent = await use_case.execute(command)
    assert sent.sequence == 1

    bob_capable_identity = state.device_crypto_identities.pop(bob_capable.id)
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(replace(command, client_message_id=uuid4()))

    state.device_crypto_identities[bob_capable.id] = bob_capable_identity
    state.device_crypto_identities[bob_legacy.id] = crypto_identity(bob_legacy, 3)
    with pytest.raises(ConversationCryptoNotReadyError):
        await use_case.execute(replace(command, client_message_id=uuid4()))
