"""Per-device durable delivery cursor specifications."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    InvalidDeliverySequenceError,
)
from messenger.application.messaging.list_delivery_states import (
    ListParticipantDeliveryStates,
    ListParticipantDeliveryStatesQuery,
)
from messenger.application.messaging.mark_delivered import (
    MarkConversationDelivered,
    MarkConversationDeliveredCommand,
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


def delivery_fixture() -> tuple[
    IdentityState, User, User, User, Device, Device, Device, Conversation
]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    charlie = User.create(username="charlie", display_name="Charlie", now=NOW)
    alice_device = Device.create(user_id=alice.id, name="Alice", now=NOW)
    bob_phone = Device.create(user_id=bob.id, name="Bob phone", now=NOW)
    bob_laptop = Device.create(user_id=bob.id, name="Bob laptop", now=NOW)
    conversation = Conversation.create_direct(created_by=alice.id, other_user_id=bob.id, now=NOW)
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
                ciphertext=b"one",
                now=NOW,
                retention=timedelta(days=30),
            ),
            Message.create(
                conversation_id=conversation.id,
                client_message_id=uuid4(),
                sender_user_id=alice.id,
                sender_device_id=alice_device.id,
                protocol_version=1,
                sequence=2,
                ciphertext=b"two",
                now=NOW + timedelta(seconds=1),
                retention=timedelta(days=30),
            ),
        )
    }
    return (
        IdentityState(
            users={user.id: user for user in (alice, bob, charlie)},
            devices={device.id: device for device in (alice_device, bob_phone, bob_laptop)},
            conversations={conversation.id: conversation},
            messages=messages,
        ),
        alice,
        bob,
        charlie,
        alice_device,
        bob_phone,
        bob_laptop,
        conversation,
    )


def use_case(state: IdentityState) -> MarkConversationDelivered:
    return MarkConversationDelivered(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
    )


async def test_delivery_cursor_is_per_device_monotonic_and_summary_is_maximum() -> None:
    state, alice, bob, _, _, bob_phone, bob_laptop, conversation = delivery_fixture()
    mark = use_case(state)

    phone = await mark.execute(
        MarkConversationDeliveredCommand(bob.id, bob_phone.id, conversation.id, 1)
    )
    duplicate = await mark.execute(
        MarkConversationDeliveredCommand(bob.id, bob_phone.id, conversation.id, 1)
    )
    laptop = await mark.execute(
        MarkConversationDeliveredCommand(bob.id, bob_laptop.id, conversation.id, 2)
    )

    assert phone.advanced is True
    assert duplicate.advanced is False
    assert laptop.last_delivered_sequence == 2
    assert len(state.delivery_states) == 2
    assert state.commits == 2
    assert len(state.sync_events) == 4
    assert all(event.event_type is SyncEventType.DELIVERY_RECEIPT for event in state.sync_events)
    assert all(event.actor_user_id == bob.id for event in state.sync_events)
    assert [event.delivery_sequence for event in state.sync_events] == [1, 1, 2, 2]

    summaries = await ListParticipantDeliveryStates(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state)
    ).execute(ListParticipantDeliveryStatesQuery(alice.id))
    assert [(item.user_id, item.delivered_sequence) for item in summaries] == [(bob.id, 2)]


async def test_revoked_device_is_rejected_and_excluded_from_summary() -> None:
    state, alice, bob, _, _, bob_phone, _, conversation = delivery_fixture()
    mark = use_case(state)
    await mark.execute(MarkConversationDeliveredCommand(bob.id, bob_phone.id, conversation.id, 2))
    state.devices[bob_phone.id] = bob_phone.revoke(NOW + timedelta(minutes=2))

    summaries = await ListParticipantDeliveryStates(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state)
    ).execute(ListParticipantDeliveryStatesQuery(alice.id))
    assert summaries == []
    with pytest.raises(AuthorizationDeniedError):
        await mark.execute(
            MarkConversationDeliveredCommand(bob.id, bob_phone.id, conversation.id, 2)
        )


async def test_delivery_rejects_foreign_device_non_member_and_unknown_sequence() -> None:
    state, alice, bob, charlie, alice_device, bob_phone, _, conversation = delivery_fixture()
    mark = use_case(state)

    with pytest.raises(AuthorizationDeniedError):
        await mark.execute(
            MarkConversationDeliveredCommand(bob.id, alice_device.id, conversation.id, 1)
        )
    charlie_device = Device.create(user_id=charlie.id, name="Charlie", now=NOW)
    state.devices[charlie_device.id] = charlie_device
    with pytest.raises(ConversationNotFoundError):
        await mark.execute(
            MarkConversationDeliveredCommand(charlie.id, charlie_device.id, conversation.id, 1)
        )
    for sequence in (0, 3):
        with pytest.raises(InvalidDeliverySequenceError):
            await mark.execute(
                MarkConversationDeliveredCommand(bob.id, bob_phone.id, conversation.id, sequence)
            )
    assert state.delivery_states == {}


async def test_read_summary_is_shared_durable_and_membership_scoped() -> None:
    state, alice, bob, charlie, _, bob_phone, _, conversation = delivery_fixture()
    mark = MarkConversationRead(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
    )
    await mark.execute(MarkConversationReadCommand(bob.id, conversation.id, 1))
    state.devices[bob_phone.id] = bob_phone.revoke(NOW + timedelta(minutes=2))
    query = ListParticipantDeliveryStates(unit_of_work=FakeMessagingUnitOfWorkFactory(state))
    summaries = await query.execute(ListParticipantDeliveryStatesQuery(alice.id))
    assert [(item.user_id, item.delivered_sequence, item.read_sequence) for item in summaries] == [
        (bob.id, 1, 1)
    ]
    assert await query.execute(ListParticipantDeliveryStatesQuery(charlie.id)) == []
    with pytest.raises(ConversationNotFoundError):
        await mark.execute(MarkConversationReadCommand(charlie.id, conversation.id, 2))
