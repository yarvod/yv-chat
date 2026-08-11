"""Shared conversation read cursor and unread-count specifications."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.application.errors import (
    ConversationNotFoundError,
    InvalidReadSequenceError,
)
from messenger.application.messaging.list_read_states import (
    ListConversationReadStates,
    ListConversationReadStatesQuery,
)
from messenger.application.messaging.mark_read import (
    MarkConversationRead,
    MarkConversationReadCommand,
)
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.domain.entities import Conversation, Device, Message, User
from tests.application.fakes import (
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def read_state_fixture() -> tuple[IdentityState, User, User, User, Conversation]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    charlie = User.create(username="charlie", display_name="Charlie", now=NOW)
    alice_device = Device.create(user_id=alice.id, name="Alice device", now=NOW)
    bob_device = Device.create(user_id=bob.id, name="Bob device", now=NOW)
    conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=NOW,
    )
    messages = {
        message.id: message
        for message in (
            Message.create(
                conversation_id=conversation.id,
                client_message_id=uuid4(),
                sender_user_id=alice.id,
                sender_device_id=alice_device.id,
                protocol_version=1,
                sequence=1,
                ciphertext=b"opaque-1",
                now=NOW,
                retention=timedelta(days=30),
            ),
            Message.create(
                conversation_id=conversation.id,
                client_message_id=uuid4(),
                sender_user_id=bob.id,
                sender_device_id=bob_device.id,
                protocol_version=1,
                sequence=2,
                ciphertext=b"opaque-2",
                now=NOW + timedelta(seconds=1),
                retention=timedelta(days=30),
            ),
        )
    }
    return (
        IdentityState(
            users={user.id: user for user in (alice, bob, charlie)},
            devices={alice_device.id: alice_device, bob_device.id: bob_device},
            conversations={conversation.id: conversation},
            messages=messages,
        ),
        alice,
        bob,
        charlie,
        conversation,
    )


async def test_list_reports_actual_unread_count_and_zero_cursor() -> None:
    state, alice, _, _, conversation = read_state_fixture()
    results = await ListConversationReadStates(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state)
    ).execute(ListConversationReadStatesQuery(alice.id))

    assert len(results) == 1
    assert results[0].conversation_id == conversation.id
    assert results[0].last_read_sequence == 0
    assert results[0].latest_sequence == 2
    assert results[0].unread_count == 2


async def test_mark_read_advances_monotonically_and_emits_durable_receipt() -> None:
    state, alice, bob, _, conversation = read_state_fixture()
    notifier = RecordingRealtimeNotifier()
    use_case = MarkConversationRead(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        sync_policy=SyncPolicy(),
        realtime_notifier=notifier,
    )

    first = await use_case.execute(MarkConversationReadCommand(alice.id, conversation.id, 1))
    duplicate = await use_case.execute(MarkConversationReadCommand(alice.id, conversation.id, 1))
    advanced = await use_case.execute(MarkConversationReadCommand(alice.id, conversation.id, 2))

    assert first.advanced is True
    assert duplicate.advanced is False
    assert advanced.last_read_sequence == 2
    assert state.read_states[(alice.id, conversation.id)].last_read_sequence == 2
    assert state.commits == 2
    assert len(state.sync_events) == 4
    assert {event.user_id for event in state.sync_events} == {alice.id, bob.id}
    assert all(event.event_type is SyncEventType.READ_RECEIPT for event in state.sync_events)
    assert [event.read_sequence for event in state.sync_events] == [1, 1, 2, 2]
    assert all(event.actor_user_id == alice.id for event in state.sync_events)
    assert len(notifier.notifications) == 4

    summary = (
        await ListConversationReadStates(
            unit_of_work=FakeMessagingUnitOfWorkFactory(state)
        ).execute(ListConversationReadStatesQuery(alice.id))
    )[0]
    assert summary.unread_count == 0


async def test_mark_read_rejects_inaccessible_or_nonexistent_sequence() -> None:
    state, alice, _, charlie, conversation = read_state_fixture()
    use_case = MarkConversationRead(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
    )

    with pytest.raises(ConversationNotFoundError):
        await use_case.execute(MarkConversationReadCommand(charlie.id, conversation.id, 1))
    for sequence in (0, 3):
        with pytest.raises(InvalidReadSequenceError):
            await use_case.execute(MarkConversationReadCommand(alice.id, conversation.id, sequence))
    assert state.read_states == {}
    assert state.sync_events == []


async def test_realtime_failure_does_not_rollback_read_cursor() -> None:
    state, alice, _, _, conversation = read_state_fixture()
    use_case = MarkConversationRead(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(fail=True),
    )

    result = await use_case.execute(MarkConversationReadCommand(alice.id, conversation.id, 2))

    assert result.advanced is True
    assert state.read_states[(alice.id, conversation.id)].last_read_sequence == 2
    assert state.commits == 1
