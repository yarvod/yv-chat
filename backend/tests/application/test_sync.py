"""Durable cursor catch-up and retention-gap specifications."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.application.sync import PendingSyncEvent, SyncEventType, SyncPolicy
from messenger.application.sync.list_events import ListSyncEvents, ListSyncEventsQuery
from messenger.domain.entities import User
from tests.application.fakes import (
    FakeSyncRepository,
    FakeSyncUnitOfWorkFactory,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def test_delivery_receipt_requires_actor_and_positive_delivery_sequence() -> None:
    valid = PendingSyncEvent.create(
        user_id=uuid4(),
        event_type=SyncEventType.DELIVERY_RECEIPT,
        conversation_id=uuid4(),
        message_id=None,
        actor_user_id=uuid4(),
        delivery_sequence=7,
        created_at=NOW,
        expires_at=NOW + timedelta(days=1),
    )
    assert valid.delivery_sequence == 7
    for actor_user_id, sequence in ((None, 7), (uuid4(), None), (uuid4(), 0)):
        with pytest.raises(ValueError):
            PendingSyncEvent.create(
                user_id=uuid4(),
                event_type=SyncEventType.DELIVERY_RECEIPT,
                conversation_id=uuid4(),
                message_id=None,
                actor_user_id=actor_user_id,
                delivery_sequence=sequence,
                created_at=NOW,
                expires_at=NOW + timedelta(days=1),
            )


async def test_sync_pages_are_user_scoped_ordered_and_bounded() -> None:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    state = IdentityState(users={alice.id: alice, bob.id: bob})
    conversation_id = uuid4()
    repository = FakeSyncRepository(state)
    await repository.append(
        [
            PendingSyncEvent.create(
                user_id=alice.id,
                event_type=SyncEventType.CONVERSATION_UPDATED,
                conversation_id=conversation_id,
                message_id=None,
                created_at=NOW,
                expires_at=NOW + timedelta(days=1),
            )
            for _ in range(3)
        ]
    )

    first = await ListSyncEvents(
        unit_of_work=FakeSyncUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        sync_policy=SyncPolicy(),
    ).execute(ListSyncEventsQuery(alice.id, after_cursor=0, limit=2))
    second = await ListSyncEvents(
        unit_of_work=FakeSyncUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        sync_policy=SyncPolicy(),
    ).execute(ListSyncEventsQuery(alice.id, after_cursor=first.next_cursor, limit=2))

    assert [event.cursor for event in first.events] == [1, 2]
    assert first.has_more is True
    assert [event.cursor for event in second.events] == [3]
    assert second.has_more is False
    assert second.next_cursor == second.stream_cursor == 3


async def test_sync_signals_retention_gap_after_expired_events_are_pruned() -> None:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    state = IdentityState(users={alice.id: alice})
    repository = FakeSyncRepository(state)
    conversation_id = uuid4()
    await repository.append(
        [
            PendingSyncEvent.create(
                user_id=alice.id,
                event_type=SyncEventType.CONVERSATION_UPDATED,
                conversation_id=conversation_id,
                message_id=None,
                created_at=NOW - timedelta(days=2),
                expires_at=NOW - timedelta(days=1),
            ),
            PendingSyncEvent.create(
                user_id=alice.id,
                event_type=SyncEventType.CONVERSATION_UPDATED,
                conversation_id=conversation_id,
                message_id=None,
                created_at=NOW,
                expires_at=NOW + timedelta(days=1),
            ),
        ]
    )

    result = await ListSyncEvents(
        unit_of_work=FakeSyncUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        sync_policy=SyncPolicy(),
    ).execute(ListSyncEventsQuery(alice.id, after_cursor=0, limit=10))

    assert [event.cursor for event in result.events] == [2]
    assert result.reset_required is True
