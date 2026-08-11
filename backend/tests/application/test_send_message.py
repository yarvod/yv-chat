"""Opaque message send authorization specifications."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    InvalidMessageEnvelopeError,
    MessageIdempotencyConflictError,
)
from messenger.application.messaging.list_messages import ListMessages, ListMessagesQuery
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.send_message import (
    SendOpaqueMessage,
    SendOpaqueMessageCommand,
)
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.domain.entities import Conversation, Device, User
from tests.application.fakes import (
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def messaging_state() -> tuple[IdentityState, User, User, User, Device, Conversation]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    charlie = User.create(username="charlie", display_name="Charlie", now=NOW)
    device = Device.create(user_id=alice.id, name="Alice device", now=NOW)
    conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=NOW,
    )
    state = IdentityState(
        users={user.id: user for user in (alice, bob, charlie)},
        devices={device.id: device},
        conversations={conversation.id: conversation},
    )
    return state, alice, bob, charlie, device, conversation


async def test_send_persists_only_opaque_envelope_metadata() -> None:
    state, alice, _, _, device, conversation = messaging_state()
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        message_policy=MessageEnvelopePolicy(),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
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


async def test_send_rejects_non_member_and_foreign_or_revoked_device() -> None:
    state, alice, _, charlie, device, conversation = messaging_state()
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        message_policy=MessageEnvelopePolicy(),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
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


async def test_send_rejects_unsupported_empty_and_oversized_envelopes() -> None:
    state, alice, _, _, device, conversation = messaging_state()
    use_case = SendOpaqueMessage(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        message_policy=MessageEnvelopePolicy(max_ciphertext_bytes=8),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
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
        sync_policy=SyncPolicy(),
        realtime_notifier=notifier,
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
