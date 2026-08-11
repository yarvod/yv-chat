"""User-scoped active-device and security-event use-case specifications."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.application.devices.list_security_events import (
    ListSecurityEvents,
    ListSecurityEventsQuery,
)
from messenger.application.devices.list_sessions import ListMySessions, ListMySessionsQuery
from messenger.application.devices.rename import (
    RenameMyDevice,
    RenameMyDeviceCommand,
)
from messenger.application.devices.revoke import (
    RevokeMyDevice,
    RevokeMyDeviceCommand,
)
from messenger.application.devices.revoke_others import (
    RevokeOtherSessions,
    RevokeOtherSessionsCommand,
)
from messenger.application.errors import (
    CurrentDeviceRevocationError,
    OwnedDeviceNotFoundError,
)
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.domain.entities import Device, SecurityEvent, SecurityEventType, Session, User
from tests.application.fakes import FakeIdentityUnitOfWorkFactory, FixedClock, IdentityState

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))


def add_active_session(
    state: IdentityState,
    *,
    user_id: UUID,
    name: str,
    now: datetime = NOW,
) -> Session:
    device = Device.create(user_id=user_id, name=name, now=now, client_ip="192.0.2.1")
    session = Session.create(
        user_id=user_id,
        device_id=device.id,
        token_hash=f"{len(state.sessions) + 1:064x}",
        now=now,
        idle_timeout=timedelta(days=30),
        absolute_lifetime=timedelta(days=90),
    )
    state.devices[device.id] = device
    state.sessions[session.id] = session
    return session


def identity_with_two_users() -> tuple[IdentityState, User, User]:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    return IdentityState(users={alice.id: alice, bob.id: bob}), alice, bob


async def test_list_returns_only_active_owned_sessions_and_marks_current() -> None:
    state, alice, bob = identity_with_two_users()
    older = add_active_session(state, user_id=alice.id, name="Laptop")
    current = add_active_session(
        state,
        user_id=alice.id,
        name="Phone",
        now=NOW + timedelta(minutes=1),
    )
    add_active_session(state, user_id=bob.id, name="Bob phone")
    expired = add_active_session(
        state,
        user_id=alice.id,
        name="Expired",
        now=NOW - timedelta(days=91),
    )

    items = await ListMySessions(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=2)),
    ).execute(
        ListMySessionsQuery(
            user_id=alice.id,
            current_session_id=current.id,
        )
    )

    assert [item.session_id for item in items] == [current.id, older.id]
    assert items[0].is_current is True
    assert items[1].is_current is False
    assert expired.id not in {item.session_id for item in items}
    assert all("hash" not in field for field in items[0].__dataclass_fields__)


async def test_rename_is_owner_scoped_and_does_not_change_session_validity() -> None:
    state, alice, bob = identity_with_two_users()
    current = add_active_session(state, user_id=alice.id, name="Laptop")
    foreign = add_active_session(state, user_id=bob.id, name="Bob phone")
    use_case = RenameMyDevice(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        event_policy=EVENT_POLICY,
    )

    result = await use_case.execute(
        RenameMyDeviceCommand(
            user_id=alice.id,
            current_session_id=current.id,
            device_id=current.device_id,
            name="  Personal laptop  ",
        )
    )

    assert result.name == "Personal laptop"
    assert state.sessions[current.id] == current
    event = next(iter(state.security_events.values()))
    assert event.event_type is SecurityEventType.DEVICE_RENAMED
    assert event.expires_at == NOW + timedelta(days=90, minutes=1)

    with pytest.raises(OwnedDeviceNotFoundError):
        await use_case.execute(
            RenameMyDeviceCommand(
                user_id=alice.id,
                current_session_id=current.id,
                device_id=foreign.device_id,
                name="Stolen",
            )
        )
    assert state.devices[foreign.device_id].name == "Bob phone"


async def test_revoke_one_blocks_current_and_foreign_device_ids() -> None:
    state, alice, bob = identity_with_two_users()
    current = add_active_session(state, user_id=alice.id, name="Current")
    other = add_active_session(state, user_id=alice.id, name="Other")
    foreign = add_active_session(state, user_id=bob.id, name="Foreign")
    use_case = RevokeMyDevice(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        event_policy=EVENT_POLICY,
    )

    with pytest.raises(CurrentDeviceRevocationError):
        await use_case.execute(RevokeMyDeviceCommand(alice.id, current.id, current.device_id))
    with pytest.raises(OwnedDeviceNotFoundError):
        await use_case.execute(RevokeMyDeviceCommand(alice.id, current.id, foreign.device_id))

    await use_case.execute(RevokeMyDeviceCommand(alice.id, current.id, other.device_id))
    assert state.sessions[current.id].revoked_at is None
    assert state.devices[current.device_id].revoked_at is None
    assert state.sessions[other.id].revoked_at == NOW + timedelta(minutes=1)
    assert state.devices[other.device_id].revoked_at == NOW + timedelta(minutes=1)
    assert state.sessions[foreign.id].revoked_at is None


async def test_revoke_others_preserves_current_and_is_idempotent() -> None:
    state, alice, bob = identity_with_two_users()
    current = add_active_session(state, user_id=alice.id, name="Current")
    first_other = add_active_session(state, user_id=alice.id, name="Laptop")
    second_other = add_active_session(state, user_id=alice.id, name="Tablet")
    foreign = add_active_session(state, user_id=bob.id, name="Foreign")
    use_case = RevokeOtherSessions(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        event_policy=EVENT_POLICY,
    )
    command = RevokeOtherSessionsCommand(alice.id, current.id)

    first = await use_case.execute(command)
    second = await use_case.execute(command)

    assert first.revoked_count == 2
    assert second.revoked_count == 0
    assert state.sessions[current.id].revoked_at is None
    assert state.devices[current.device_id].revoked_at is None
    assert state.sessions[first_other.id].revoked_at is not None
    assert state.sessions[second_other.id].revoked_at is not None
    assert state.sessions[foreign.id].revoked_at is None


async def test_security_event_list_filters_owner_expiry_and_limit() -> None:
    state, alice, bob = identity_with_two_users()
    current = add_active_session(state, user_id=alice.id, name="Current")
    events = [
        SecurityEvent.create(
            user_id=alice.id,
            event_type=SecurityEventType.LOGIN,
            now=NOW - timedelta(minutes=offset),
            retention=timedelta(days=1),
            actor_session_id=current.id,
        )
        for offset in (1, 2, 3)
    ]
    expired = SecurityEvent.create(
        user_id=alice.id,
        event_type=SecurityEventType.LOGOUT,
        now=NOW - timedelta(days=2),
        retention=timedelta(days=1),
    )
    foreign = SecurityEvent.create(
        user_id=bob.id,
        event_type=SecurityEventType.LOGIN,
        now=NOW,
        retention=timedelta(days=1),
    )
    state.security_events = {event.id: event for event in [*events, expired, foreign]}

    items = await ListSecurityEvents(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
    ).execute(ListSecurityEventsQuery(user_id=alice.id, limit=2))

    assert [item.id for item in items] == [events[0].id, events[1].id]
    assert all(item.id not in {expired.id, foreign.id} for item in items)
