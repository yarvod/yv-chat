"""Message reaction authorization and idempotency specifications."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from messenger.application.errors import ConversationNotFoundError, MessageNotFoundError
from messenger.application.messaging.message_reactions import (
    ListMessageReactions,
    ListMessageReactionsQuery,
    SetMessageReaction,
    SetMessageReactionCommand,
)
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.domain.entities import (
    ALLOWED_MESSAGE_REACTIONS,
    Conversation,
    Device,
    Message,
    User,
)
from tests.application.fakes import (
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)
RETENTION = MessageRetentionPolicy(timedelta(days=30), timedelta(days=90))


def reaction_state() -> tuple[IdentityState, User, User, User, Message, Conversation]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    mallory = User.create(username="mallory", display_name="Mallory", now=NOW)
    device = Device.create(user_id=alice.id, name="Alice device", now=NOW)
    conversation = Conversation.create_group(
        created_by=alice.id,
        title="Team",
        now=NOW,
    ).add_member(bob.id, NOW)
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
    state = IdentityState(
        users={item.id: item for item in (alice, bob, mallory)},
        devices={device.id: device},
        conversations={conversation.id: conversation},
        messages={message.id: message},
    )
    return state, alice, bob, mallory, message, conversation


async def test_reactions_are_idempotent_aggregated_and_durably_notified() -> None:
    state, alice, bob, _, message, conversation = reaction_state()
    notifier = RecordingRealtimeNotifier()
    use_case = SetMessageReaction(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
        sync_policy=SyncPolicy(),
        realtime_notifier=notifier,
    )

    first = await use_case.execute(
        SetMessageReactionCommand(alice.id, conversation.id, message.id, "👍", True)
    )
    duplicate = await use_case.execute(
        SetMessageReactionCommand(alice.id, conversation.id, message.id, "👍", True)
    )
    second_user = await use_case.execute(
        SetMessageReactionCommand(bob.id, conversation.id, message.id, "👍", True)
    )

    assert first[0].count == 1 and first[0].reacted_by_actor is True
    assert first[0].actor_user_ids == (alice.id,)
    assert duplicate == first
    assert second_user[0].count == 2 and second_user[0].reacted_by_actor is True
    assert second_user[0].actor_user_ids == tuple(
        sorted((alice.id, bob.id), key=lambda user_id: user_id.int)
    )
    assert len(state.sync_events) == 4
    assert all(
        event.event_type is SyncEventType.MESSAGE_REACTION_UPDATED for event in state.sync_events
    )
    assert len(notifier.notifications) == 4

    removed = await use_case.execute(
        SetMessageReactionCommand(alice.id, conversation.id, message.id, "👍", False)
    )
    assert removed[0].count == 1 and removed[0].reacted_by_actor is False
    listed = await ListMessageReactions(unit_of_work=FakeMessagingUnitOfWorkFactory(state)).execute(
        ListMessageReactionsQuery(alice.id, conversation.id, (message.id,))
    )
    assert listed == removed


async def test_direct_participants_can_list_exact_reaction_actors() -> None:
    state, alice, bob, _, message, _ = reaction_state()
    direct = Conversation.create_direct(created_by=alice.id, other_user_id=bob.id, now=NOW)
    direct_message = replace(message, conversation_id=direct.id)
    state.conversations = {direct.id: direct}
    state.messages = {direct_message.id: direct_message}
    use_case = SetMessageReaction(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
    )
    await use_case.execute(
        SetMessageReactionCommand(alice.id, direct.id, direct_message.id, "🔥", True)
    )
    result = await use_case.execute(
        SetMessageReactionCommand(bob.id, direct.id, direct_message.id, "🔥", True)
    )

    assert result[0].count == 2
    assert result[0].actor_user_ids == tuple(
        sorted((alice.id, bob.id), key=lambda user_id: user_id.int)
    )


async def test_reaction_authorization_rejects_outsider_foreign_and_invalid_values() -> None:
    state, alice, _, mallory, message, conversation = reaction_state()
    use_case = SetMessageReaction(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
    )

    with pytest.raises(ConversationNotFoundError):
        await use_case.execute(
            SetMessageReactionCommand(mallory.id, conversation.id, message.id, "👍", True)
        )
    with pytest.raises(MessageNotFoundError):
        await use_case.execute(
            SetMessageReactionCommand(alice.id, conversation.id, mallory.id, "👍", True)
        )
    with pytest.raises(ValueError, match="unsupported"):
        await use_case.execute(
            SetMessageReactionCommand(alice.id, conversation.id, message.id, "not-an-emoji", True)
        )


async def test_extended_reaction_palette_uses_the_same_durable_flow() -> None:
    state, alice, _, _, message, conversation = reaction_state()
    use_case = SetMessageReaction(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        sync_policy=SyncPolicy(),
        realtime_notifier=RecordingRealtimeNotifier(),
    )

    result = await use_case.execute(
        SetMessageReactionCommand(alice.id, conversation.id, message.id, "🫶", True)
    )

    assert len(ALLOWED_MESSAGE_REACTIONS) == 48
    assert len(set(ALLOWED_MESSAGE_REACTIONS)) == 48
    assert result[0].reaction == "🫶"
    assert result[0].count == 1
    assert result[0].reacted_by_actor is True
