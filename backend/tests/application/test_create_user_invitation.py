"""Admin-controlled invitation specifications."""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.application.errors import AuthorizationDeniedError, DuplicateUsernameError
from messenger.application.use_cases.create_user_invitation import (
    CreateUserInvitation,
    CreateUserInvitationCommand,
)
from messenger.domain.entities import User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FixedActivationSecrets,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
ADMIN_ID = UUID("72a468ba-8757-4e41-8504-11c8e4e62c04")
TOKEN_DIGEST = "a" * 64


def build_use_case(state: IdentityState) -> CreateUserInvitation:
    return CreateUserInvitation(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        secrets=FixedActivationSecrets("one-time-secret", TOKEN_DIGEST),
        activation_ttl=timedelta(hours=24),
    )


def active_user(*, user_id: UUID, is_admin: bool) -> User:
    return User.create(
        user_id=user_id,
        username="admin" if is_admin else "member",
        display_name="Admin" if is_admin else "Member",
        now=NOW,
        is_admin=is_admin,
    )


def test_active_admin_creates_inactive_user_and_one_time_secret() -> None:
    state = IdentityState(users={ADMIN_ID: active_user(user_id=ADMIN_ID, is_admin=True)})
    use_case = build_use_case(state)

    result = asyncio.run(
        use_case.execute(
            CreateUserInvitationCommand(
                actor_user_id=ADMIN_ID,
                username=" Alice ",
                display_name="Alice",
            )
        )
    )

    invited = state.users[result.user_id]
    stored_token = next(iter(state.tokens.values()))
    assert invited.username == "alice"
    assert invited.is_active is False
    assert result.activation_secret == "one-time-secret"
    assert stored_token.token_hash == TOKEN_DIGEST
    assert stored_token.token_hash != result.activation_secret
    assert result.expires_at == NOW + timedelta(hours=24)
    assert state.commits == 1


@pytest.mark.parametrize("actor_state", ["missing", "non_admin", "inactive_admin"])
def test_non_active_admin_cannot_create_invitation(actor_state: str) -> None:
    state = IdentityState()
    if actor_state == "non_admin":
        state.users[ADMIN_ID] = active_user(user_id=ADMIN_ID, is_admin=False)
    elif actor_state == "inactive_admin":
        state.users[ADMIN_ID] = User.invite(
            user_id=ADMIN_ID,
            username="admin",
            display_name="Admin",
            now=NOW,
        )

    with pytest.raises(AuthorizationDeniedError):
        asyncio.run(
            build_use_case(state).execute(
                CreateUserInvitationCommand(
                    actor_user_id=ADMIN_ID,
                    username="alice",
                    display_name="Alice",
                )
            )
        )

    assert state.commits == 0
    assert not state.tokens


def test_duplicate_username_is_case_insensitive() -> None:
    existing_id = UUID("13e2cd2e-97e7-48f0-a06b-dd4c6baec7d4")
    state = IdentityState(
        users={
            ADMIN_ID: active_user(user_id=ADMIN_ID, is_admin=True),
            existing_id: User.invite(
                user_id=existing_id,
                username="alice",
                display_name="Alice",
                now=NOW,
            ),
        }
    )

    with pytest.raises(DuplicateUsernameError):
        asyncio.run(
            build_use_case(state).execute(
                CreateUserInvitationCommand(
                    actor_user_id=ADMIN_ID,
                    username="ALICE",
                    display_name="Other Alice",
                )
            )
        )

    assert state.commits == 0
