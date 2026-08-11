"""Application specifications for the authenticated participant directory."""

from dataclasses import replace

import pytest

from messenger.application.accounts.list_directory import (
    ListUserDirectory,
    ListUserDirectoryQuery,
)
from messenger.application.errors import SessionNotAuthenticatedError
from messenger.domain.entities import User
from tests.application.fakes import FakeIdentityUnitOfWorkFactory, IdentityState
from tests.test_auth_http import NOW


async def test_directory_contains_only_active_users_and_public_identity_fields() -> None:
    alice = User.create(username="alice", display_name="Alice", now=NOW)
    bob = User.create(username="bob", display_name="Bob", now=NOW, is_admin=True)
    invited = User.invite(username="charlie", display_name="Charlie", now=NOW)
    state = IdentityState(users={user.id: user for user in (bob, invited, alice)})
    use_case = ListUserDirectory(unit_of_work=FakeIdentityUnitOfWorkFactory(state))

    result = await use_case.execute(ListUserDirectoryQuery(alice.id))

    assert [(item.username, item.display_name) for item in result] == [
        ("alice", "Alice"),
        ("bob", "Bob"),
    ]
    assert set(result[0].__dataclass_fields__) == {"user_id", "username", "display_name"}


async def test_inactive_actor_cannot_read_directory() -> None:
    actor = User.create(username="alice", display_name="Alice", now=NOW)
    state = IdentityState(users={actor.id: replace(actor, is_active=False)})
    use_case = ListUserDirectory(unit_of_work=FakeIdentityUnitOfWorkFactory(state))

    with pytest.raises(SessionNotAuthenticatedError):
        await use_case.execute(ListUserDirectoryQuery(actor.id))
