"""Message pin authorization, bounds and durable sync specifications."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    MessageNotFoundError,
    MessagePinLimitError,
)
from messenger.application.messaging.message_pins import (
    MAX_MESSAGE_PINS_PER_CONVERSATION,
    ListMessagePins,
    ListMessagePinsQuery,
    SetMessagePin,
    SetMessagePinCommand,
)
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.domain.entities import (
    Conversation,
    ConversationMemberRole,
    Device,
    Message,
    MessagePin,
    User,
)
from tests.application.fakes import (
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 17, 12, 0, tzinfo=UTC)
RETENTION = MessageRetentionPolicy(timedelta(days=30), timedelta(days=90))


def pin_state(
    *, direct: bool = False
) -> tuple[IdentityState, User, User, User, Message, Conversation]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    mallory = User.create(username="mallory", display_name="Mallory", now=NOW)
    device = Device.create(user_id=alice.id, name="Alice device", now=NOW)
    conversation = (
        Conversation.create_direct(created_by=alice.id, other_user_id=bob.id, now=NOW)
        if direct
        else Conversation.create_group(created_by=alice.id, title="Team", now=NOW).add_member(
            bob.id, NOW
        )
    )
    message = Message.create(
        conversation_id=conversation.id,
        client_message_id=device.id,
        sender_user_id=alice.id,
        sender_device_id=device.id,
        protocol_version=1,
        sequence=1,
        ciphertext=b"opaque",
        now=NOW,
        retention=RETENTION.ciphertext_retention,
    )
    return (
        IdentityState(
            users={item.id: item for item in (alice, bob, mallory)},
            devices={device.id: device},
            conversations={conversation.id: conversation},
            messages={message.id: message},
        ),
        alice,
        bob,
        mallory,
        message,
        conversation,
    )


def pin_use_case(state: IdentityState) -> tuple[SetMessagePin, RecordingRealtimeNotifier]:
    notifier = RecordingRealtimeNotifier()
    return (
        SetMessagePin(
            unit_of_work=FakeMessagingUnitOfWorkFactory(state),
            clock=FixedClock(NOW + timedelta(seconds=1)),
            sync_policy=SyncPolicy(),
            realtime_notifier=notifier,
        ),
        notifier,
    )


async def test_direct_participant_can_idempotently_pin_and_unpin_with_durable_events() -> None:
    state, _, bob, _, message, conversation = pin_state(direct=True)
    use_case, notifier = pin_use_case(state)

    first = await use_case.execute(SetMessagePinCommand(bob.id, conversation.id, message.id, True))
    duplicate = await use_case.execute(
        SetMessagePinCommand(bob.id, conversation.id, message.id, True)
    )

    assert first == duplicate
    assert first[0].message_id == message.id
    assert first[0].sequence == message.sequence
    assert first[0].pinned_by_user_id == bob.id
    assert len(state.sync_events) == 2
    assert all(event.event_type is SyncEventType.MESSAGE_PIN_UPDATED for event in state.sync_events)
    assert len(notifier.notifications) == 2

    assert (
        await use_case.execute(SetMessagePinCommand(bob.id, conversation.id, message.id, False))
        == []
    )
    assert state.message_pins == {}


async def test_group_pin_requires_admin_and_hides_foreign_or_expired_messages() -> None:
    state, alice, bob, mallory, message, conversation = pin_state()
    use_case, _ = pin_use_case(state)

    with pytest.raises(AuthorizationDeniedError):
        await use_case.execute(SetMessagePinCommand(bob.id, conversation.id, message.id, True))
    with pytest.raises(ConversationNotFoundError):
        await use_case.execute(SetMessagePinCommand(mallory.id, conversation.id, message.id, True))
    with pytest.raises(MessageNotFoundError):
        await use_case.execute(SetMessagePinCommand(alice.id, conversation.id, mallory.id, True))

    state.conversations[conversation.id] = conversation.change_member_role(
        bob.id,
        ConversationMemberRole.ADMIN,
        NOW + timedelta(seconds=1),
    )
    assert (
        await use_case.execute(SetMessagePinCommand(bob.id, conversation.id, message.id, True))
    )[0].message_id == message.id

    listed = await ListMessagePins(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(message.expires_at),
    ).execute(ListMessagePinsQuery(alice.id, conversation.id))
    assert listed == []


async def test_pin_limit_is_bounded_under_conversation_lock() -> None:
    state, alice, _, _, message, conversation = pin_state()
    device = next(iter(state.devices.values()))
    for sequence in range(1, MAX_MESSAGE_PINS_PER_CONVERSATION + 1):
        item = (
            message
            if sequence == 1
            else Message.create(
                conversation_id=conversation.id,
                client_message_id=uuid4(),
                sender_user_id=alice.id,
                sender_device_id=device.id,
                protocol_version=1,
                sequence=sequence,
                ciphertext=b"opaque",
                now=NOW,
                retention=RETENTION.ciphertext_retention,
            )
        )
        state.messages[item.id] = item
        state.message_pins[item.id] = MessagePin(
            conversation.id,
            item.id,
            alice.id,
            NOW + timedelta(microseconds=sequence),
        )
    overflow = Message.create(
        conversation_id=conversation.id,
        client_message_id=uuid4(),
        sender_user_id=alice.id,
        sender_device_id=device.id,
        protocol_version=1,
        sequence=MAX_MESSAGE_PINS_PER_CONVERSATION + 1,
        ciphertext=b"opaque",
        now=NOW,
        retention=RETENTION.ciphertext_retention,
    )
    state.messages[overflow.id] = overflow
    use_case, _ = pin_use_case(state)

    with pytest.raises(MessagePinLimitError):
        await use_case.execute(SetMessagePinCommand(alice.id, conversation.id, overflow.id, True))
