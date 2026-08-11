"""Administrator account-management application specifications."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from messenger.application.accounts.list_users import ListManagedUsers, ListManagedUsersQuery
from messenger.application.accounts.reissue_activation import (
    ReissueActivation,
    ReissueActivationCommand,
)
from messenger.application.accounts.update_user import (
    UpdateManagedUser,
    UpdateManagedUserCommand,
)
from messenger.application.errors import (
    AccountActivationRequiredError,
    AccountAlreadyActiveError,
    AuthorizationDeniedError,
    ManagedUserNotFoundError,
    SelfDeactivationError,
)
from messenger.domain.entities import ActivationToken, Device, Session, User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FixedClock,
    IdentityState,
    SequentialActivationSecrets,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
ADMIN_ID = UUID("72a468ba-8757-4e41-8504-11c8e4e62c04")
MEMBER_ID = UUID("c49b454d-e88b-4bb5-a484-a2ec00dad34c")


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
    )
    state.devices[device.id] = device
    state.sessions[session.id] = session
    return session


def management_state() -> IdentityState:
    return IdentityState(
        users={
            ADMIN_ID: active_user(ADMIN_ID, "admin", is_admin=True),
            MEMBER_ID: active_user(MEMBER_ID, "alice"),
        },
        password_hashes={ADMIN_ID: "admin-hash", MEMBER_ID: "member-hash"},
    )


async def test_list_requires_active_admin_and_never_returns_password_hash() -> None:
    state = management_state()
    use_case = ListManagedUsers(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
    )

    page = await use_case.execute(ListManagedUsersQuery(actor_user_id=ADMIN_ID))

    assert [user.username for user in page.items] == ["admin", "alice"]
    assert page.total == 2
    assert all("password" not in field for field in page.items[0].__dataclass_fields__)

    with pytest.raises(AuthorizationDeniedError):
        await use_case.execute(ListManagedUsersQuery(actor_user_id=MEMBER_ID))


async def test_list_search_pagination_and_active_session_summary_are_bounded() -> None:
    state = management_state()
    add_session(state, MEMBER_ID, 1)
    use_case = ListManagedUsers(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
    )

    page = await use_case.execute(
        ListManagedUsersQuery(actor_user_id=ADMIN_ID, search="ALI", limit=1, offset=0)
    )

    assert page.total == 1
    assert [item.username for item in page.items] == ["alice"]
    assert page.items[0].active_sessions == 1
    with pytest.raises(ValueError, match="limit"):
        await use_case.execute(ListManagedUsersQuery(actor_user_id=ADMIN_ID, limit=51))


async def test_deactivate_revokes_every_target_session_and_reactivate_preserves_admin() -> None:
    state = management_state()
    first = add_session(state, MEMBER_ID, 1)
    second = add_session(state, MEMBER_ID, 2)
    admin_session = add_session(state, ADMIN_ID, 3)
    use_case = UpdateManagedUser(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
    )

    result = await use_case.execute(
        UpdateManagedUserCommand(
            actor_user_id=ADMIN_ID,
            target_user_id=MEMBER_ID,
            display_name="  Alice Updated  ",
            is_active=False,
        )
    )

    assert result.display_name == "Alice Updated"
    assert result.is_active is False
    assert result.revoked_sessions == 2
    assert state.sessions[first.id].revoked_at == NOW + timedelta(minutes=1)
    assert state.sessions[second.id].revoked_at == NOW + timedelta(minutes=1)
    assert state.sessions[admin_session.id].revoked_at is None

    reactivated = await use_case.execute(
        UpdateManagedUserCommand(
            actor_user_id=ADMIN_ID,
            target_user_id=MEMBER_ID,
            is_active=True,
        )
    )
    assert reactivated.is_active is True
    assert reactivated.can_reactivate is False


async def test_update_rejects_self_deactivation_invite_bypass_and_unknown_user() -> None:
    invited_id = UUID("54cc0624-1054-4f76-ae3d-cc308f0a42d4")
    state = management_state()
    state.users[invited_id] = User.invite(
        user_id=invited_id,
        username="pending",
        display_name="Pending",
        now=NOW,
    )
    use_case = UpdateManagedUser(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
    )

    with pytest.raises(SelfDeactivationError):
        await use_case.execute(UpdateManagedUserCommand(ADMIN_ID, ADMIN_ID, is_active=False))
    with pytest.raises(AccountActivationRequiredError):
        await use_case.execute(UpdateManagedUserCommand(ADMIN_ID, invited_id, is_active=True))
    with pytest.raises(ManagedUserNotFoundError):
        await use_case.execute(
            UpdateManagedUserCommand(ADMIN_ID, UUID(int=0), display_name="Missing")
        )


async def test_reissue_revokes_previous_secret_and_rejects_activated_accounts() -> None:
    invited_id = UUID("54cc0624-1054-4f76-ae3d-cc308f0a42d4")
    state = management_state()
    state.users[invited_id] = User.invite(
        user_id=invited_id,
        username="pending",
        display_name="Pending",
        now=NOW,
    )
    old_token = ActivationToken.create(
        user_id=invited_id,
        token_hash="a" * 64,
        created_at=NOW,
        expires_at=NOW + timedelta(days=1),
    )
    state.tokens[old_token.id] = old_token
    secrets = SequentialActivationSecrets()
    use_case = ReissueActivation(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(minutes=1)),
        secrets=secrets,
        activation_ttl=timedelta(days=1),
    )

    result = await use_case.execute(ReissueActivationCommand(ADMIN_ID, invited_id))

    assert result.activation_secret == "activation-secret-00000000000000000000000000000001"
    assert state.tokens[old_token.id].revoked_at == NOW + timedelta(minutes=1)
    new_tokens = [token for token in state.tokens.values() if token.id != old_token.id]
    assert len(new_tokens) == 1
    assert new_tokens[0].token_hash == secrets.digest(result.activation_secret)
    assert result.activation_secret not in new_tokens[0].token_hash

    with pytest.raises(AccountAlreadyActiveError):
        await use_case.execute(ReissueActivationCommand(ADMIN_ID, MEMBER_ID))
    with pytest.raises(AuthorizationDeniedError):
        await use_case.execute(ReissueActivationCommand(MEMBER_ID, invited_id))
