"""Admin-issued purpose-bound password recovery specifications."""

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.application.accounts.issue_password_reset import (
    IssuePasswordReset,
    IssuePasswordResetCommand,
)
from messenger.application.accounts.password_reset_policy import PasswordResetPolicy
from messenger.application.accounts.reset_password import (
    ResetPasswordWithToken,
    ResetPasswordWithTokenCommand,
)
from messenger.application.errors import (
    AccountActivationRequiredError,
    AuthorizationDeniedError,
    InvalidPasswordResetSecretError,
    SelfPasswordResetError,
)
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.domain.entities import ActivationToken, Device, PasswordResetToken, Session, User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FakePasswordHasher,
    FixedClock,
    FixedPasswordResetSecrets,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
ADMIN_ID = UUID("72a468ba-8757-4e41-8504-11c8e4e62c04")
MEMBER_ID = UUID("c49b454d-e88b-4bb5-a484-a2ec00dad34c")
ADMIN_SESSION_ID = UUID("72a468ba-8757-4e41-8504-11c8e4e62c05")
RESET_SECRET = "reset-secret-with-at-least-thirty-two-bytes"
RESET_DIGEST = hashlib.sha256(RESET_SECRET.encode()).hexdigest()
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))


def active_user(user_id: UUID, username: str, *, is_admin: bool = False) -> User:
    return User.create(
        user_id=user_id,
        username=username,
        display_name=username.title(),
        now=NOW,
        is_admin=is_admin,
    )


def add_session(state: IdentityState, user_id: UUID, sequence: int) -> Session:
    device = Device.create(user_id=user_id, name=f"Device {sequence}", now=NOW)
    session = Session.create(
        user_id=user_id,
        device_id=device.id,
        token_hash=f"{sequence:064x}",
        now=NOW,
        idle_timeout=timedelta(days=30),
        absolute_lifetime=timedelta(days=90),
        session_id=ADMIN_SESSION_ID if user_id == ADMIN_ID else None,
    )
    state.devices[device.id] = device
    state.sessions[session.id] = session
    return session


def reset_state() -> IdentityState:
    return IdentityState(
        users={
            ADMIN_ID: active_user(ADMIN_ID, "admin", is_admin=True),
            MEMBER_ID: active_user(MEMBER_ID, "alice"),
        },
        password_hashes={ADMIN_ID: "admin-hash", MEMBER_ID: "member-hash"},
    )


def issue_use_case(state: IdentityState, now: datetime = NOW) -> IssuePasswordReset:
    return IssuePasswordReset(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(now),
        secrets=FixedPasswordResetSecrets(RESET_SECRET, RESET_DIGEST),
        password_reset_policy=PasswordResetPolicy(ttl=timedelta(hours=1)),
        event_policy=EVENT_POLICY,
    )


def reset_use_case(
    state: IdentityState,
    passwords: FakePasswordHasher,
    now: datetime = NOW + timedelta(minutes=5),
) -> ResetPasswordWithToken:
    return ResetPasswordWithToken(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(now),
        secrets=FixedPasswordResetSecrets(RESET_SECRET, RESET_DIGEST),
        passwords=passwords,
        event_policy=EVENT_POLICY,
    )


async def test_issue_revokes_target_sessions_replaces_token_and_never_stores_secret() -> None:
    state = reset_state()
    member_session = add_session(state, MEMBER_ID, 1)
    admin_session = add_session(state, ADMIN_ID, 2)
    old_token = PasswordResetToken.create(
        user_id=MEMBER_ID,
        token_hash="f" * 64,
        created_at=NOW - timedelta(minutes=5),
        expires_at=NOW + timedelta(minutes=30),
    )
    state.password_reset_tokens[old_token.id] = old_token

    result = await issue_use_case(state).execute(
        IssuePasswordResetCommand(ADMIN_ID, ADMIN_SESSION_ID, MEMBER_ID)
    )

    assert result.reset_secret == RESET_SECRET
    assert result.revoked_sessions == 1
    assert state.sessions[member_session.id].revoked_at == NOW
    assert state.devices[member_session.device_id].revoked_at == NOW
    assert state.sessions[admin_session.id].revoked_at is None
    assert state.password_reset_tokens[old_token.id].revoked_at == NOW
    created = [item for item in state.password_reset_tokens.values() if item.id != old_token.id]
    assert len(created) == 1
    assert created[0].token_hash == RESET_DIGEST
    assert RESET_SECRET not in repr(state.password_reset_tokens)
    assert {event.event_type.value for event in state.security_events.values()} == {
        "password_reset_issued"
    }


async def test_issue_requires_admin_activation_and_rejects_self() -> None:
    state = reset_state()
    invited_id = UUID("54cc0624-1054-4f76-ae3d-cc308f0a42d4")
    state.users[invited_id] = User.invite(
        user_id=invited_id,
        username="pending",
        display_name="Pending",
        now=NOW,
    )
    use_case = issue_use_case(state)

    with pytest.raises(AuthorizationDeniedError):
        await use_case.execute(IssuePasswordResetCommand(MEMBER_ID, UUID(int=1), ADMIN_ID))
    with pytest.raises(SelfPasswordResetError):
        await use_case.execute(IssuePasswordResetCommand(ADMIN_ID, ADMIN_SESSION_ID, ADMIN_ID))
    with pytest.raises(AccountActivationRequiredError):
        await use_case.execute(IssuePasswordResetCommand(ADMIN_ID, ADMIN_SESSION_ID, invited_id))


async def test_reset_consumes_token_changes_password_and_keeps_disabled_state() -> None:
    state = reset_state()
    state.users[MEMBER_ID] = state.users[MEMBER_ID].deactivate(NOW)
    token = PasswordResetToken.create(
        user_id=MEMBER_ID,
        token_hash=RESET_DIGEST,
        created_at=NOW,
        expires_at=NOW + timedelta(hours=1),
    )
    state.password_reset_tokens[token.id] = token
    activation_token = ActivationToken.create(
        user_id=MEMBER_ID,
        token_hash="a" * 64,
        created_at=NOW,
        expires_at=NOW + timedelta(hours=1),
    )
    state.tokens[activation_token.id] = activation_token
    passwords = FakePasswordHasher()

    result = await reset_use_case(state, passwords).execute(
        ResetPasswordWithTokenCommand(RESET_SECRET, "new correct horse battery staple")
    )

    assert result.user_id == MEMBER_ID
    assert state.password_reset_tokens[token.id].used_at == NOW + timedelta(minutes=5)
    assert state.tokens[activation_token.id].used_at is None
    assert state.password_hashes[MEMBER_ID] == "$argon2id$fake-hash"
    assert passwords.hashed_passwords == ["new correct horse battery staple"]
    assert state.users[MEMBER_ID].is_active is False
    assert {event.event_type.value for event in state.security_events.values()} == {
        "password_reset_completed"
    }


@pytest.mark.parametrize("state_name", ["unknown", "expired", "used", "revoked"])
async def test_reset_rejects_every_invalid_lifecycle_with_one_error(state_name: str) -> None:
    state = reset_state()
    if state_name != "unknown":
        token = PasswordResetToken.create(
            user_id=MEMBER_ID,
            token_hash=RESET_DIGEST,
            created_at=NOW,
            expires_at=NOW + timedelta(minutes=1),
        )
        if state_name == "used":
            token = token.mark_used(NOW + timedelta(seconds=1))
        elif state_name == "revoked":
            token = token.revoke(NOW + timedelta(seconds=1))
        state.password_reset_tokens[token.id] = token

    with pytest.raises(InvalidPasswordResetSecretError, match="password reset failed"):
        await reset_use_case(state, FakePasswordHasher()).execute(
            ResetPasswordWithTokenCommand(RESET_SECRET, "new correct horse battery staple")
        )
