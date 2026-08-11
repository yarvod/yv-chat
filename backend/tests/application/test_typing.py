"""Authorized ephemeral typing indicator specifications."""

from datetime import UTC, datetime, timedelta

import pytest

from messenger.application.errors import ConversationNotFoundError
from messenger.application.realtime import RealtimeEventType
from messenger.application.realtime.typing import (
    PublishTyping,
    PublishTypingCommand,
    TypingPolicy,
)
from messenger.domain.entities import Conversation, User
from tests.application.fakes import (
    FakeMessagingUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def typing_fixture() -> tuple[IdentityState, User, User, User, Conversation]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    charlie = User.create(username="charlie", display_name="Charlie", now=NOW)
    conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=NOW,
    )
    state = IdentityState(
        users={user.id: user for user in (alice, bob, charlie)},
        conversations={conversation.id: conversation},
    )
    return state, alice, bob, charlie, conversation


async def test_typing_is_recipient_scoped_ephemeral_and_server_expired() -> None:
    state, alice, bob, _, conversation = typing_fixture()
    notifier = RecordingRealtimeNotifier()
    use_case = PublishTyping(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        policy=TypingPolicy(active_ttl=timedelta(seconds=4)),
        realtime_notifier=notifier,
    )

    await use_case.execute(PublishTypingCommand(alice.id, conversation.id, True))
    await use_case.execute(PublishTypingCommand(alice.id, conversation.id, False))

    assert state.commits == 0
    assert state.sync_events == []
    assert len(notifier.notifications) == 2
    started, stopped = notifier.notifications
    assert started.user_id == stopped.user_id == bob.id
    assert started.event_type is RealtimeEventType.TYPING
    assert started.actor_user_id == alice.id
    assert started.typing_active is True
    assert started.expires_at == NOW + timedelta(seconds=4)
    assert stopped.typing_active is False
    assert stopped.expires_at == NOW


async def test_non_member_cannot_publish_typing() -> None:
    state, _, _, charlie, conversation = typing_fixture()
    notifier = RecordingRealtimeNotifier()
    use_case = PublishTyping(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        policy=TypingPolicy(),
        realtime_notifier=notifier,
    )

    with pytest.raises(ConversationNotFoundError):
        await use_case.execute(PublishTypingCommand(charlie.id, conversation.id, True))
    assert notifier.notifications == []
    assert state.sync_events == []


def test_typing_policy_rejects_unbounded_expiry() -> None:
    for ttl in (timedelta(0), timedelta(seconds=31)):
        with pytest.raises(ValueError):
            TypingPolicy(active_ttl=ttl)
