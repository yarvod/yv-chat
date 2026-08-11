"""Authorized process-local presence specifications."""

from datetime import UTC, datetime

from messenger.application.realtime import RealtimeEventType
from messenger.application.realtime.presence import (
    ListPresenceSnapshot,
    ListPresenceSnapshotQuery,
    PublishPresence,
    PublishPresenceCommand,
)
from messenger.domain.entities import Conversation, User
from messenger.infrastructure.realtime import InMemoryRealtimeHub
from tests.application.fakes import (
    FakeMessagingUnitOfWorkFactory,
    IdentityState,
    RecordingRealtimeNotifier,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


async def test_presence_snapshot_and_transition_are_membership_scoped_and_ephemeral() -> None:
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
    hub = InMemoryRealtimeHub()
    await hub.subscribe(user_id=bob.id, session_id=bob.id)
    await hub.subscribe(user_id=charlie.id, session_id=charlie.id)

    snapshot = await ListPresenceSnapshot(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        realtime_hub=hub,
    ).execute(ListPresenceSnapshotQuery(alice.id))

    assert [(item.conversation_id, item.user_id) for item in snapshot] == [
        (conversation.id, bob.id)
    ]
    notifier = RecordingRealtimeNotifier()
    publish = PublishPresence(
        unit_of_work=FakeMessagingUnitOfWorkFactory(state),
        realtime_notifier=notifier,
    )
    await publish.execute(PublishPresenceCommand(alice.id, True))
    await publish.execute(PublishPresenceCommand(alice.id, False))

    assert state.commits == 0
    assert state.sync_events == []
    assert len(notifier.notifications) == 2
    assert {item.user_id for item in notifier.notifications} == {bob.id}
    assert all(item.event_type is RealtimeEventType.PRESENCE for item in notifier.notifications)
    assert [item.presence_online for item in notifier.notifications] == [True, False]
