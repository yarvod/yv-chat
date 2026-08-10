"""Initial administrator bootstrap specifications."""

import asyncio
from datetime import UTC, datetime

import pytest

from messenger.application.errors import BootstrapAlreadyCompletedError, WeakPasswordError
from messenger.application.use_cases.bootstrap_admin import BootstrapAdmin, BootstrapAdminCommand
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FakePasswordHasher,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def build_use_case(state: IdentityState, passwords: FakePasswordHasher) -> BootstrapAdmin:
    return BootstrapAdmin(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        passwords=passwords,
    )


def test_empty_database_accepts_exactly_one_explicit_admin() -> None:
    state = IdentityState()
    passwords = FakePasswordHasher()
    command = BootstrapAdminCommand(
        username="root-admin",
        display_name="Administrator",
        password="correct horse battery staple",
    )

    result = asyncio.run(build_use_case(state, passwords).execute(command))

    admin = state.users[result.user_id]
    assert admin.is_admin is True
    assert admin.is_active is True
    assert state.password_hashes[result.user_id] == "$argon2id$fake-hash"
    assert state.commits == 1

    with pytest.raises(BootstrapAlreadyCompletedError):
        asyncio.run(build_use_case(state, passwords).execute(command))

    assert state.commits == 1


def test_weak_bootstrap_password_is_rejected_before_hashing() -> None:
    state = IdentityState()
    passwords = FakePasswordHasher()

    with pytest.raises(WeakPasswordError):
        asyncio.run(
            build_use_case(state, passwords).execute(
                BootstrapAdminCommand(
                    username="admin",
                    display_name="Administrator",
                    password="short",
                )
            )
        )

    assert not passwords.hashed_passwords
