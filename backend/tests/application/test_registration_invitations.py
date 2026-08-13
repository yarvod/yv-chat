"""Standalone managed registration invitation specifications."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.application.accounts.create_registration_invitation import (
    CreateRegistrationInvitation,
    CreateRegistrationInvitationCommand,
)
from messenger.application.accounts.list_registration_invitations import (
    ListRegistrationInvitations,
    ListRegistrationInvitationsQuery,
)
from messenger.application.accounts.register_with_invitation import (
    RegisterWithInvitation,
    RegisterWithInvitationCommand,
)
from messenger.application.accounts.revoke_registration_invitation import (
    RevokeRegistrationInvitation,
    RevokeRegistrationInvitationCommand,
)
from messenger.application.errors import (
    AuthorizationDeniedError,
    DuplicateUsernameError,
    InvalidRegistrationInvitationError,
)
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.policy import SessionPolicy
from messenger.domain.entities import ActivationToken, RegistrationInvitation, User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FakePasswordHasher,
    FixedActivationSecrets,
    FixedClock,
    FixedSessionCredentials,
    IdentityState,
)

NOW = datetime(2026, 8, 13, 12, 0, tzinfo=UTC)
ADMIN_ID = UUID("72a468ba-8757-4e41-8504-11c8e4e62c04")
DIGEST = "b" * 64
POLICY = SessionPolicy(
    idle_timeout=timedelta(hours=2),
    absolute_lifetime=timedelta(hours=3),
    rotation_interval=timedelta(hours=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))


def admin() -> User:
    return User.create(
        user_id=ADMIN_ID,
        username="admin",
        display_name="Admin",
        now=NOW,
        is_admin=True,
    )


def registration_use_case(
    state: IdentityState,
    passwords: FakePasswordHasher,
) -> RegisterWithInvitation:
    return RegisterWithInvitation(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        secrets=FixedActivationSecrets("one-time-secret", DIGEST),
        passwords=passwords,
        credentials=FixedSessionCredentials(),
        policy=POLICY,
        event_policy=EVENT_POLICY,
    )


def invitation(
    *,
    expires_at: datetime,
    revoked_at: datetime | None = None,
) -> RegistrationInvitation:
    item = RegistrationInvitation.create(
        token_hash=DIGEST,
        label="Для Алисы",
        created_by_user_id=ADMIN_ID,
        created_at=NOW - timedelta(hours=1),
        expires_at=expires_at,
    )
    return item.revoke(revoked_at) if revoked_at is not None else item


async def test_admin_creates_safe_standalone_invitation_and_lists_it() -> None:
    state = IdentityState(users={ADMIN_ID: admin()})
    create = CreateRegistrationInvitation(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        secrets=FixedActivationSecrets("one-time-secret", DIGEST),
        activation_ttl=timedelta(hours=24),
    )
    result = await create.execute(
        CreateRegistrationInvitationCommand(actor_user_id=ADMIN_ID, label=" Для Алисы ")
    )

    assert len(state.users) == 1
    stored = state.registration_invitations[result.invitation_id]
    assert stored.label == "Для Алисы"
    assert stored.token_hash == DIGEST
    assert result.activation_secret == "one-time-secret"

    page = await ListRegistrationInvitations(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
    ).execute(ListRegistrationInvitationsQuery(actor_user_id=ADMIN_ID))
    assert page.items[0].status == "active"
    assert page.items[0].created_by_username == "admin"


async def test_non_admin_cannot_create_or_list_invitations() -> None:
    member = User.create(username="member", display_name="Member", now=NOW)
    state = IdentityState(users={member.id: member})
    create = CreateRegistrationInvitation(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        secrets=FixedActivationSecrets("one-time-secret", DIGEST),
        activation_ttl=timedelta(hours=24),
    )
    with pytest.raises(AuthorizationDeniedError):
        await create.execute(CreateRegistrationInvitationCommand(actor_user_id=member.id))
    with pytest.raises(AuthorizationDeniedError):
        await ListRegistrationInvitations(
            unit_of_work=FakeIdentityUnitOfWorkFactory(state),
            clock=FixedClock(NOW),
        ).execute(ListRegistrationInvitationsQuery(actor_user_id=member.id))


async def test_registration_creates_account_device_session_and_consumes_invite() -> None:
    item = invitation(expires_at=NOW + timedelta(hours=1))
    state = IdentityState(
        users={ADMIN_ID: admin()},
        registration_invitations={item.id: item},
    )
    passwords = FakePasswordHasher()
    result = await registration_use_case(state, passwords).execute(
        RegisterWithInvitationCommand(
            activation_secret="one-time-secret",
            username=" Alice ",
            display_name="Alice",
            password="correct horse battery staple",
            device_name="Safari · iOS · Телефон",
            client_ip="192.0.2.10",
        )
    )

    assert state.users[result.user_id].username == "alice"
    assert result.device_id in state.devices
    assert result.session_id in state.sessions
    assert state.registration_invitations[item.id].registered_user_id == result.user_id
    assert passwords.hashed_passwords == ["correct horse battery staple"]


async def test_duplicate_username_does_not_consume_invitation() -> None:
    existing = User.create(username="alice", display_name="Alice", now=NOW)
    item = invitation(expires_at=NOW + timedelta(hours=1))
    state = IdentityState(
        users={ADMIN_ID: admin(), existing.id: existing},
        registration_invitations={item.id: item},
    )
    passwords = FakePasswordHasher()
    with pytest.raises(DuplicateUsernameError):
        await registration_use_case(state, passwords).execute(
            RegisterWithInvitationCommand(
                activation_secret="one-time-secret",
                username="ALICE",
                display_name="Other Alice",
                password="correct horse battery staple",
                device_name="Phone",
            )
        )
    assert state.registration_invitations[item.id].used_at is None
    assert passwords.hashed_passwords == []


@pytest.mark.parametrize("state_name", ["missing", "expired", "revoked", "used"])
async def test_invalid_invitation_fails_before_password_hash(state_name: str) -> None:
    invitations: dict[UUID, RegistrationInvitation] = {}
    users = {ADMIN_ID: admin()}
    if state_name == "expired":
        item = invitation(expires_at=NOW)
        invitations[item.id] = item
    elif state_name == "revoked":
        item = invitation(expires_at=NOW + timedelta(hours=1), revoked_at=NOW)
        invitations[item.id] = item
    elif state_name == "used":
        registered = User.create(username="registered", display_name="Registered", now=NOW)
        users[registered.id] = registered
        item = invitation(expires_at=NOW + timedelta(hours=1)).redeem(
            user_id=registered.id,
            now=NOW,
        )
        invitations[item.id] = item
    state = IdentityState(users=users, registration_invitations=invitations)
    passwords = FakePasswordHasher()
    with pytest.raises(InvalidRegistrationInvitationError):
        await registration_use_case(state, passwords).execute(
            RegisterWithInvitationCommand(
                activation_secret="one-time-secret",
                username="alice",
                display_name="Alice",
                password="correct horse battery staple",
                device_name="Phone",
            )
        )
    assert passwords.hashed_passwords == []


async def test_admin_revocation_immediately_invalidates_invitation() -> None:
    item = invitation(expires_at=NOW + timedelta(hours=1))
    state = IdentityState(
        users={ADMIN_ID: admin()},
        registration_invitations={item.id: item},
    )
    result = await RevokeRegistrationInvitation(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
    ).execute(
        RevokeRegistrationInvitationCommand(
            actor_user_id=ADMIN_ID,
            invitation_id=item.id,
        )
    )
    assert result.revoked_at == NOW
    assert state.registration_invitations[item.id].revoked_at == NOW


async def test_legacy_invitation_claims_user_identity_and_creates_session() -> None:
    invited = User.invite(username="legacy-name", display_name="Legacy", now=NOW)
    token = ActivationToken.create(
        user_id=invited.id,
        token_hash=DIGEST,
        created_at=NOW,
        expires_at=NOW + timedelta(hours=1),
    )
    state = IdentityState(
        users={ADMIN_ID: admin(), invited.id: invited},
        tokens={token.id: token},
    )
    result = await registration_use_case(state, FakePasswordHasher()).execute(
        RegisterWithInvitationCommand(
            activation_secret="one-time-secret",
            username="chosen-name",
            display_name="Chosen Name",
            password="correct horse battery staple",
            device_name="Phone",
        )
    )
    assert result.user_id == invited.id
    assert state.users[invited.id].username == "chosen-name"
    assert state.users[invited.id].display_name == "Chosen Name"
    assert state.users[invited.id].is_active is True
    assert state.tokens[token.id].used_at == NOW
