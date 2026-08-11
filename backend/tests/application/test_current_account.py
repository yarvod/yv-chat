"""Current-account self-service application specifications."""

from datetime import UTC, datetime, timedelta

import pytest

from messenger.application.accounts.change_password import (
    ChangeCurrentPassword,
    ChangeCurrentPasswordCommand,
)
from messenger.application.accounts.get_current import GetCurrentAccount, GetCurrentAccountQuery
from messenger.application.accounts.security_reset import SecurityReset, SecurityResetCommand
from messenger.application.accounts.update_profile import (
    UpdateCurrentProfile,
    UpdateCurrentProfileCommand,
)
from messenger.application.errors import (
    InvalidStepUpCredentialsError,
    SessionNotAuthenticatedError,
)
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.domain.entities import Device, SecurityEventType, Session, User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FakePasswordHasher,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "new correct horse battery staple"
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))


def current_account_state() -> tuple[IdentityState, User, Session, Session]:
    user = User.create(username="alice", display_name="Alice", now=NOW)
    state = IdentityState(
        users={user.id: user},
        password_hashes={user.id: "$argon2id$fake-hash"},
    )
    sessions: list[Session] = []
    for sequence, name in enumerate(("Current", "Other"), start=1):
        device = Device.create(user_id=user.id, name=name, now=NOW)
        session = Session.create(
            user_id=user.id,
            device_id=device.id,
            token_hash=f"{sequence:064x}",
            now=NOW,
            idle_timeout=timedelta(days=30),
            absolute_lifetime=timedelta(days=90),
        )
        state.devices[device.id] = device
        state.sessions[session.id] = session
        sessions.append(session)
    return state, user, sessions[0], sessions[1]


def password_hasher() -> FakePasswordHasher:
    hasher = FakePasswordHasher()
    hasher.hashed_passwords.append(PASSWORD)
    return hasher


async def test_get_and_update_current_profile_expose_only_safe_fields() -> None:
    state, user, _, _ = current_account_state()
    factory = FakeIdentityUnitOfWorkFactory(state)

    current = await GetCurrentAccount(unit_of_work=factory).execute(
        GetCurrentAccountQuery(user_id=user.id)
    )
    updated = await UpdateCurrentProfile(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(minutes=1)),
    ).execute(UpdateCurrentProfileCommand(user_id=user.id, display_name="  Alice Updated  "))

    assert current.username == "alice"
    assert all("password" not in field for field in current.__dataclass_fields__)
    assert updated.display_name == "Alice Updated"


async def test_password_change_requires_step_up_and_revokes_only_other_sessions() -> None:
    state, user, current, other = current_account_state()
    factory = FakeIdentityUnitOfWorkFactory(state)
    hasher = password_hasher()
    use_case = ChangeCurrentPassword(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(minutes=1)),
        passwords=hasher,
        event_policy=EVENT_POLICY,
    )

    with pytest.raises(InvalidStepUpCredentialsError):
        await use_case.execute(
            ChangeCurrentPasswordCommand(
                user.id,
                current.id,
                "wrong password",
                NEW_PASSWORD,
            )
        )
    assert state.sessions[other.id].revoked_at is None

    result = await use_case.execute(
        ChangeCurrentPasswordCommand(user.id, current.id, PASSWORD, NEW_PASSWORD)
    )

    assert result.revoked_sessions == 1
    assert state.sessions[current.id].revoked_at is None
    assert state.sessions[other.id].revoked_at == NOW + timedelta(minutes=1)
    assert state.devices[other.device_id].revoked_at == NOW + timedelta(minutes=1)
    assert (
        next(iter(state.security_events.values())).event_type is SecurityEventType.PASSWORD_CHANGED
    )


async def test_security_reset_revokes_current_and_all_other_sessions() -> None:
    state, user, current, other = current_account_state()
    result = await SecurityReset(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        passwords=password_hasher(),
        event_policy=EVENT_POLICY,
    ).execute(SecurityResetCommand(user.id, current.id, PASSWORD))

    assert result.revoked_sessions == 2
    assert state.sessions[current.id].revoked_at is not None
    assert state.sessions[other.id].revoked_at is not None
    assert next(iter(state.security_events.values())).event_type is SecurityEventType.SECURITY_RESET

    with pytest.raises(SessionNotAuthenticatedError):
        await SecurityReset(
            unit_of_work=FakeIdentityUnitOfWorkFactory(state),
            clock=FixedClock(NOW + timedelta(minutes=2)),
            passwords=password_hasher(),
            event_policy=EVENT_POLICY,
        ).execute(SecurityResetCommand(user.id, current.id, PASSWORD))
