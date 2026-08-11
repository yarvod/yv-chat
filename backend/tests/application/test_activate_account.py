"""One-time account activation specifications."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.application.accounts.activate import ActivateAccount, ActivateAccountCommand
from messenger.application.errors import (
    AccountAlreadyActiveError,
    ActivationAlreadyUsedError,
    ActivationExpiredError,
    InvalidActivationSecretError,
    WeakPasswordError,
)
from messenger.domain.entities import ActivationToken, User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FakePasswordHasher,
    FixedActivationSecrets,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("c49b454d-e88b-4bb5-a484-a2ec00dad34c")
TOKEN_ID = UUID("54cc0624-1054-4f76-ae3d-cc308f0a42d4")
TOKEN_DIGEST = "b" * 64
PASSWORD = "correct horse battery staple"


def invited_user() -> User:
    return User.invite(
        user_id=USER_ID,
        username="alice",
        display_name="Alice",
        now=NOW - timedelta(hours=1),
    )


def activation_token(*, expires_at: datetime, used_at: datetime | None = None) -> ActivationToken:
    return ActivationToken(
        id=TOKEN_ID,
        user_id=USER_ID,
        token_hash=TOKEN_DIGEST,
        created_at=NOW - timedelta(hours=1),
        expires_at=expires_at,
        used_at=used_at,
    )


def build_use_case(
    state: IdentityState,
    passwords: FakePasswordHasher,
) -> ActivateAccount:
    return ActivateAccount(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        secrets=FixedActivationSecrets("one-time-secret", TOKEN_DIGEST),
        passwords=passwords,
    )


async def test_valid_secret_activates_once_and_stores_only_password_hash() -> None:
    token = activation_token(expires_at=NOW + timedelta(hours=1))
    state = IdentityState(users={USER_ID: invited_user()}, tokens={TOKEN_ID: token})
    passwords = FakePasswordHasher()

    result = await build_use_case(state, passwords).execute(
        ActivateAccountCommand(
            activation_secret="one-time-secret",
            password=PASSWORD,
        )
    )

    assert result.user_id == USER_ID
    assert state.users[USER_ID].is_active is True
    assert state.password_hashes[USER_ID] == "$argon2id$fake-hash"
    assert state.tokens[TOKEN_ID].used_at == NOW
    assert PASSWORD not in state.password_hashes.values()
    assert state.commits == 1


@pytest.mark.parametrize(
    ("token", "expected_error"),
    [
        (None, InvalidActivationSecretError),
        (activation_token(expires_at=NOW), ActivationExpiredError),
        (
            activation_token(expires_at=NOW + timedelta(hours=1), used_at=NOW),
            ActivationAlreadyUsedError,
        ),
    ],
)
async def test_invalid_token_states_never_hash_password(
    token: ActivationToken | None,
    expected_error: type[Exception],
) -> None:
    state = IdentityState(users={USER_ID: invited_user()})
    if token is not None:
        state.tokens[TOKEN_ID] = token
    passwords = FakePasswordHasher()

    with pytest.raises(expected_error):
        await build_use_case(state, passwords).execute(
            ActivateAccountCommand(
                activation_secret="one-time-secret",
                password=PASSWORD,
            )
        )

    assert not passwords.hashed_passwords
    assert state.commits == 0


async def test_active_account_cannot_be_activated_again() -> None:
    token = activation_token(expires_at=NOW + timedelta(hours=1))
    state = IdentityState(
        users={
            USER_ID: User.create(
                user_id=USER_ID,
                username="alice",
                display_name="Alice",
                now=NOW - timedelta(hours=1),
            )
        },
        tokens={TOKEN_ID: token},
    )

    with pytest.raises(AccountAlreadyActiveError):
        await build_use_case(state, FakePasswordHasher()).execute(
            ActivateAccountCommand(
                activation_secret="one-time-secret",
                password=PASSWORD,
            )
        )


@pytest.mark.parametrize("password", ["short", "x" * 129])
async def test_password_length_is_bounded_before_token_lookup(password: str) -> None:
    state = IdentityState()

    with pytest.raises(WeakPasswordError):
        await build_use_case(state, FakePasswordHasher()).execute(
            ActivateAccountCommand(
                activation_secret="one-time-secret",
                password=password,
            )
        )
