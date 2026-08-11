"""Password login and opaque-session application specifications."""

from datetime import UTC, datetime, timedelta

import pytest

from messenger.application.errors import (
    InvalidCredentialsError,
    SessionCredentialReplayError,
    SessionNotAuthenticatedError,
)
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.authenticate import (
    AuthenticateSession,
    AuthenticateSessionCommand,
)
from messenger.application.sessions.login import Login, LoginCommand
from messenger.application.sessions.logout import Logout, LogoutCommand
from messenger.application.sessions.policy import SessionPolicy
from messenger.domain.entities import SecurityEventType, User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FakePasswordHasher,
    FixedClock,
    FixedSessionCredentials,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"
POLICY = SessionPolicy(
    idle_timeout=timedelta(hours=2),
    absolute_lifetime=timedelta(hours=3),
    rotation_interval=timedelta(hours=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))


def active_identity() -> tuple[IdentityState, FakePasswordHasher]:
    user = User.create(
        username="alice",
        display_name="Alice",
        now=NOW,
    )
    state = IdentityState(
        users={user.id: user},
        password_hashes={user.id: "$argon2id$fake-hash"},
    )
    passwords = FakePasswordHasher()
    passwords.hashed_passwords.append(PASSWORD)
    return state, passwords


def login_use_case(
    state: IdentityState,
    passwords: FakePasswordHasher,
    credentials: FixedSessionCredentials,
) -> Login:
    return Login(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        passwords=passwords,
        credentials=credentials,
        policy=POLICY,
        event_policy=EVENT_POLICY,
    )


async def issue_session() -> tuple[IdentityState, FixedSessionCredentials, str]:
    state, passwords = active_identity()
    credentials = FixedSessionCredentials()
    result = await login_use_case(state, passwords, credentials).execute(
        LoginCommand(
            username="Alice",
            password=PASSWORD,
            device_name="Personal laptop",
            client_ip="2001:0db8::1",
        )
    )
    return state, credentials, result.session_credential


async def test_login_enrolls_device_and_persists_only_credential_digest() -> None:
    state, credentials, plaintext = await issue_session()

    session = next(iter(state.sessions.values()))
    device = state.devices[session.device_id]

    assert plaintext == "opaque-session-1"
    assert session.current_token_hash == credentials.digest(plaintext)
    assert plaintext not in session.current_token_hash
    assert session.previous_token_hash is None
    assert device.user_id == session.user_id
    assert device.login_ip == "2001:db8::1"
    assert device.last_ip == "2001:db8::1"
    event = next(iter(state.security_events.values()))
    assert event.event_type is SecurityEventType.LOGIN
    assert event.actor_session_id == session.id
    assert event.target_device_id == device.id
    assert state.commits == 1


@pytest.mark.parametrize("case", ["unknown", "inactive", "wrong-password"])
async def test_login_uses_one_generic_error_and_creates_no_device(case: str) -> None:
    state, passwords = active_identity()
    if case == "unknown":
        username = "nobody"
    else:
        user = next(iter(state.users.values()))
        username = user.username
        if case == "inactive":
            state.users[user.id] = User.invite(
                user_id=user.id,
                username=user.username,
                display_name=user.display_name,
                now=user.created_at,
            )
        else:
            passwords.hashed_passwords.clear()

    with pytest.raises(InvalidCredentialsError, match="invalid username or password"):
        await login_use_case(state, passwords, FixedSessionCredentials()).execute(
            LoginCommand(
                username=username,
                password=PASSWORD,
                device_name="Laptop",
            )
        )

    assert not state.devices
    assert not state.sessions
    assert state.commits == 0


async def test_rotation_allows_concurrent_previous_credential_then_revokes_replay() -> None:
    state, credentials, original = await issue_session()
    factory = FakeIdentityUnitOfWorkFactory(state)

    rotate = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=1)),
        credentials=credentials,
        policy=POLICY,
        event_policy=EVENT_POLICY,
    )
    rotated = await rotate.execute(AuthenticateSessionCommand(session_credential=original))
    replacement = rotated.rotated_session_credential

    assert replacement == "opaque-session-2"
    within_grace = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=1, seconds=59)),
        credentials=credentials,
        policy=POLICY,
        event_policy=EVENT_POLICY,
    )
    concurrent = await within_grace.execute(AuthenticateSessionCommand(session_credential=original))
    assert concurrent.rotated_session_credential is None

    replay = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=1, seconds=60)),
        credentials=credentials,
        policy=POLICY,
        event_policy=EVENT_POLICY,
    )
    with pytest.raises(SessionCredentialReplayError):
        await replay.execute(AuthenticateSessionCommand(session_credential=original))

    session = next(iter(state.sessions.values()))
    assert session.revoked_at == NOW + timedelta(hours=1, seconds=60)
    assert any(
        event.event_type is SecurityEventType.CREDENTIAL_REPLAY
        for event in state.security_events.values()
    )
    with pytest.raises(SessionNotAuthenticatedError):
        await replay.execute(
            AuthenticateSessionCommand(session_credential=replacement or "missing")
        )


async def test_touch_is_throttled_and_ip_change_does_not_revoke() -> None:
    state, credentials, plaintext = await issue_session()
    factory = FakeIdentityUnitOfWorkFactory(state)
    original_absolute_expiry = next(iter(state.sessions.values())).absolute_expires_at

    touch = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(minutes=5)),
        credentials=credentials,
        policy=POLICY,
        event_policy=EVENT_POLICY,
    )
    await touch.execute(
        AuthenticateSessionCommand(
            session_credential=plaintext,
            client_ip="203.0.113.8",
        )
    )
    touched = next(iter(state.sessions.values()))
    device = state.devices[touched.device_id]

    assert touched.last_seen_at == NOW + timedelta(minutes=5)
    assert touched.idle_expires_at == NOW + timedelta(hours=2, minutes=5)
    assert touched.absolute_expires_at == original_absolute_expiry
    assert device.last_ip == "203.0.113.8"
    assert touched.revoked_at is None
    commits_after_touch = state.commits

    no_touch = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(minutes=6)),
        credentials=credentials,
        policy=POLICY,
        event_policy=EVENT_POLICY,
    )
    await no_touch.execute(
        AuthenticateSessionCommand(
            session_credential=plaintext,
            client_ip="203.0.113.8",
        )
    )
    assert state.commits == commits_after_touch


async def test_idle_expiry_and_logout_revoke_session_idempotently() -> None:
    state, credentials, plaintext = await issue_session()
    factory = FakeIdentityUnitOfWorkFactory(state)
    expired = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=2)),
        credentials=credentials,
        policy=POLICY,
        event_policy=EVENT_POLICY,
    )

    with pytest.raises(SessionNotAuthenticatedError):
        await expired.execute(AuthenticateSessionCommand(session_credential=plaintext))
    assert next(iter(state.sessions.values())).revoked_at == NOW + timedelta(hours=2)

    logout = Logout(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=2, minutes=1)),
        credentials=credentials,
        event_policy=EVENT_POLICY,
    )
    await logout.execute(LogoutCommand(session_credential=plaintext))
    await logout.execute(LogoutCommand(session_credential="unknown"))
    assert next(iter(state.sessions.values())).revoked_at == NOW + timedelta(hours=2)
