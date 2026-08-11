"""Realtime hub and passive session specifications."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from messenger.application.errors import (
    RealtimeSubscriptionClosedError,
    SessionNotAuthenticatedError,
)
from messenger.application.realtime import RealtimeEventType, RealtimeNotification
from messenger.application.sessions.validate_active import (
    ValidateActiveSession,
    ValidateActiveSessionQuery,
)
from messenger.domain.entities import Device, Session, User
from messenger.infrastructure.realtime import InMemoryRealtimeHub
from tests.application.fakes import FakeIdentityUnitOfWorkFactory, FixedClock, IdentityState

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def notification(user_id: UUID) -> RealtimeNotification:
    return RealtimeNotification(
        user_id=user_id,
        event_id=uuid4(),
        event_type=RealtimeEventType.NEW_MESSAGE,
        conversation_id=uuid4(),
        message_id=uuid4(),
        actor_user_id=None,
        read_sequence=None,
    )


async def test_hub_fans_out_by_user_and_drops_slow_connection() -> None:
    alice_id = uuid4()
    bob_id = uuid4()
    hub = InMemoryRealtimeHub(queue_size=1)
    alice = await hub.subscribe(user_id=alice_id, session_id=uuid4())
    bob = await hub.subscribe(user_id=bob_id, session_id=uuid4())
    first = notification(alice_id)
    await hub.publish((first,))
    assert await alice.receive() == first
    assert bob.queue.empty()

    await hub.publish((notification(alice_id), notification(alice_id)))
    assert await hub.active_count() == 1
    with pytest.raises(RealtimeSubscriptionClosedError):
        await alice.receive()
    await hub.unsubscribe(bob)
    assert await hub.active_count() == 0


async def test_hub_presence_transitions_are_user_level_across_devices() -> None:
    user_id = uuid4()
    hub = InMemoryRealtimeHub()
    first = await hub.subscribe(user_id=user_id, session_id=uuid4())
    second = await hub.subscribe(user_id=user_id, session_id=uuid4())

    assert first.became_online is True
    assert second.became_online is False
    assert await hub.online_user_ids({user_id, uuid4()}) == {user_id}
    assert await hub.unsubscribe(first) is False
    assert await hub.online_user_ids({user_id}) == {user_id}
    assert await hub.unsubscribe(second) is True
    assert await hub.online_user_ids({user_id}) == set()


async def test_passive_revalidation_never_touches_session() -> None:
    user = User.create(username="alice", display_name="Alice", now=NOW)
    device = Device.create(user_id=user.id, name="Browser", now=NOW)
    session = Session.create(
        user_id=user.id,
        device_id=device.id,
        token_hash="a" * 64,
        now=NOW,
        idle_timeout=timedelta(hours=1),
        absolute_lifetime=timedelta(hours=2),
    )
    state = IdentityState(
        users={user.id: user},
        devices={device.id: device},
        sessions={session.id: session},
    )
    use_case = ValidateActiveSession(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=30)),
    )
    query = ValidateActiveSessionQuery(user.id, session.id, device.id)
    await use_case.execute(query)
    assert state.sessions[session.id] == session
    assert state.devices[device.id] == device
    assert state.commits == 0

    state.sessions[session.id] = session.revoke(NOW + timedelta(minutes=31))
    with pytest.raises(SessionNotAuthenticatedError):
        await use_case.execute(query)
