"""Password login and opaque-session application specifications."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from messenger.application.errors import (
    InvalidCredentialsError,
    SessionCredentialReplayError,
    SessionNotAuthenticatedError,
)
from messenger.application.session_policy import SessionPolicy
from messenger.application.use_cases.authenticate_session import (
    AuthenticateSession,
    AuthenticateSessionCommand,
)
from messenger.application.use_cases.login import Login, LoginCommand
from messenger.application.use_cases.logout import Logout, LogoutCommand
from messenger.domain.entities import User
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
    )


def issue_session() -> tuple[IdentityState, FixedSessionCredentials, str]:
    state, passwords = active_identity()
    credentials = FixedSessionCredentials()
    result = asyncio.run(
        login_use_case(state, passwords, credentials).execute(
            LoginCommand(
                username="Alice",
                password=PASSWORD,
                device_name="Personal laptop",
                client_ip="2001:0db8::1",
            )
        )
    )
    return state, credentials, result.session_credential


def test_login_enrolls_device_and_persists_only_credential_digest() -> None:
    state, credentials, plaintext = issue_session()

    session = next(iter(state.sessions.values()))
    device = state.devices[session.device_id]

    assert plaintext == "opaque-session-1"
    assert session.current_token_hash == credentials.digest(plaintext)
    assert plaintext not in session.current_token_hash
    assert session.previous_token_hash is None
    assert device.user_id == session.user_id
    assert device.login_ip == "2001:db8::1"
    assert device.last_ip == "2001:db8::1"
    assert state.commits == 1


@pytest.mark.parametrize("case", ["unknown", "inactive", "wrong-password"])
def test_login_uses_one_generic_error_and_creates_no_device(case: str) -> None:
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
        asyncio.run(
            login_use_case(state, passwords, FixedSessionCredentials()).execute(
                LoginCommand(
                    username=username,
                    password=PASSWORD,
                    device_name="Laptop",
                )
            )
        )

    assert not state.devices
    assert not state.sessions
    assert state.commits == 0


def test_rotation_allows_concurrent_previous_credential_then_revokes_replay() -> None:
    state, credentials, original = issue_session()
    factory = FakeIdentityUnitOfWorkFactory(state)

    rotate = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=1)),
        credentials=credentials,
        policy=POLICY,
    )
    rotated = asyncio.run(rotate.execute(AuthenticateSessionCommand(session_credential=original)))
    replacement = rotated.rotated_session_credential

    assert replacement == "opaque-session-2"
    within_grace = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=1, seconds=59)),
        credentials=credentials,
        policy=POLICY,
    )
    concurrent = asyncio.run(
        within_grace.execute(AuthenticateSessionCommand(session_credential=original))
    )
    assert concurrent.rotated_session_credential is None

    replay = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=1, seconds=60)),
        credentials=credentials,
        policy=POLICY,
    )
    with pytest.raises(SessionCredentialReplayError):
        asyncio.run(replay.execute(AuthenticateSessionCommand(session_credential=original)))

    session = next(iter(state.sessions.values()))
    assert session.revoked_at == NOW + timedelta(hours=1, seconds=60)
    with pytest.raises(SessionNotAuthenticatedError):
        asyncio.run(
            replay.execute(AuthenticateSessionCommand(session_credential=replacement or "missing"))
        )


def test_touch_is_throttled_and_ip_change_does_not_revoke() -> None:
    state, credentials, plaintext = issue_session()
    factory = FakeIdentityUnitOfWorkFactory(state)
    original_absolute_expiry = next(iter(state.sessions.values())).absolute_expires_at

    touch = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(minutes=5)),
        credentials=credentials,
        policy=POLICY,
    )
    asyncio.run(
        touch.execute(
            AuthenticateSessionCommand(
                session_credential=plaintext,
                client_ip="203.0.113.8",
            )
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
    )
    asyncio.run(
        no_touch.execute(
            AuthenticateSessionCommand(
                session_credential=plaintext,
                client_ip="203.0.113.8",
            )
        )
    )
    assert state.commits == commits_after_touch


def test_idle_expiry_and_logout_revoke_session_idempotently() -> None:
    state, credentials, plaintext = issue_session()
    factory = FakeIdentityUnitOfWorkFactory(state)
    expired = AuthenticateSession(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=2)),
        credentials=credentials,
        policy=POLICY,
    )

    with pytest.raises(SessionNotAuthenticatedError):
        asyncio.run(expired.execute(AuthenticateSessionCommand(session_credential=plaintext)))
    assert next(iter(state.sessions.values())).revoked_at == NOW + timedelta(hours=2)

    logout = Logout(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(hours=2, minutes=1)),
        credentials=credentials,
    )
    asyncio.run(logout.execute(LogoutCommand(session_credential=plaintext)))
    asyncio.run(logout.execute(LogoutCommand(session_credential="unknown")))
    assert next(iter(state.sessions.values())).revoked_at == NOW + timedelta(hours=2)
