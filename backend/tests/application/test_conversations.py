"""Conversation use-case authorization specifications."""

from datetime import UTC, datetime, timedelta

import pytest

from messenger.application.conversations.add_member import (
    AddConversationMember,
    AddConversationMemberCommand,
)
from messenger.application.conversations.change_member_role import (
    ChangeConversationMemberRole,
    ChangeConversationMemberRoleCommand,
)
from messenger.application.conversations.create_direct import (
    CreateDirectConversation,
    CreateDirectConversationCommand,
)
from messenger.application.conversations.create_group import (
    CreateGroupConversation,
    CreateGroupConversationCommand,
)
from messenger.application.conversations.get_conversation import (
    GetConversation,
    GetConversationQuery,
)
from messenger.application.conversations.leave_conversation import (
    LeaveConversation,
    LeaveConversationCommand,
)
from messenger.application.conversations.list_conversations import (
    ListConversations,
    ListConversationsQuery,
)
from messenger.application.conversations.remove_member import (
    RemoveConversationMember,
    RemoveConversationMemberCommand,
)
from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    DuplicateDirectConversationError,
)
from messenger.application.sync import SyncPolicy
from messenger.domain.entities import ConversationMemberRole, User
from tests.application.fakes import (
    FakeConversationUnitOfWorkFactory,
    FixedClock,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
SYNC_POLICY = SyncPolicy()


def conversation_state() -> tuple[IdentityState, User, User, User]:
    users = (
        User.create(username="alice", display_name="Alice", now=NOW),
        User.create(username="bob", display_name="Bob", now=NOW),
        User.create(username="charlie", display_name="Charlie", now=NOW),
    )
    return IdentityState(users={user.id: user for user in users}), *users


async def test_create_direct_group_list_and_non_member_get() -> None:
    state, alice, bob, charlie = conversation_state()
    factory = FakeConversationUnitOfWorkFactory(state)
    clock = FixedClock(NOW + timedelta(minutes=1))

    direct = await CreateDirectConversation(
        unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY
    ).execute(CreateDirectConversationCommand(alice.id, bob.id))
    with pytest.raises(DuplicateDirectConversationError):
        await CreateDirectConversation(
            unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY
        ).execute(CreateDirectConversationCommand(bob.id, alice.id))
    group = await CreateGroupConversation(
        unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY
    ).execute(CreateGroupConversationCommand(alice.id, "MVP team", (bob.id,)))

    listed = await ListConversations(unit_of_work=factory).execute(ListConversationsQuery(bob.id))
    assert {item.conversation_id for item in listed} == {
        direct.conversation_id,
        group.conversation_id,
    }
    assert {member.username for member in group.members} == {"alice", "bob"}
    with pytest.raises(ConversationNotFoundError):
        await GetConversation(unit_of_work=factory).execute(
            GetConversationQuery(charlie.id, group.conversation_id)
        )


async def test_group_role_policy_add_remove_and_removed_member_visibility() -> None:
    state, alice, bob, charlie = conversation_state()
    factory = FakeConversationUnitOfWorkFactory(state)
    clock = FixedClock(NOW + timedelta(minutes=1))
    group = await CreateGroupConversation(
        unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY
    ).execute(CreateGroupConversationCommand(alice.id, "MVP team", (bob.id,)))

    with pytest.raises(AuthorizationDeniedError):
        await AddConversationMember(
            unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY
        ).execute(AddConversationMemberCommand(bob.id, group.conversation_id, charlie.id))

    promoted = await ChangeConversationMemberRole(
        unit_of_work=factory,
        clock=clock,
        sync_policy=SYNC_POLICY,
    ).execute(
        ChangeConversationMemberRoleCommand(
            alice.id,
            group.conversation_id,
            bob.id,
            ConversationMemberRole.ADMIN,
        )
    )
    assert next(member for member in promoted.members if member.user_id == bob.id).role is (
        ConversationMemberRole.ADMIN
    )

    await AddConversationMember(unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY).execute(
        AddConversationMemberCommand(bob.id, group.conversation_id, charlie.id)
    )
    with pytest.raises(AuthorizationDeniedError):
        await RemoveConversationMember(
            unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY
        ).execute(RemoveConversationMemberCommand(bob.id, group.conversation_id, alice.id))

    await RemoveConversationMember(
        unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY
    ).execute(RemoveConversationMemberCommand(alice.id, group.conversation_id, bob.id))
    with pytest.raises(ConversationNotFoundError):
        await GetConversation(unit_of_work=factory).execute(
            GetConversationQuery(bob.id, group.conversation_id)
        )
    assert (
        await ListConversations(unit_of_work=factory).execute(ListConversationsQuery(bob.id)) == []
    )
    assert any(
        event.user_id == bob.id
        and event.conversation_id == group.conversation_id
        and event.event_type.value == "conversation_updated"
        for event in state.sync_events
    )


async def test_member_can_leave_but_owner_cannot() -> None:
    state, alice, bob, _ = conversation_state()
    factory = FakeConversationUnitOfWorkFactory(state)
    clock = FixedClock(NOW + timedelta(minutes=1))
    group = await CreateGroupConversation(
        unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY
    ).execute(CreateGroupConversationCommand(alice.id, "MVP team", (bob.id,)))

    with pytest.raises(AuthorizationDeniedError):
        await LeaveConversation(unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY).execute(
            LeaveConversationCommand(alice.id, group.conversation_id)
        )
    await LeaveConversation(unit_of_work=factory, clock=clock, sync_policy=SYNC_POLICY).execute(
        LeaveConversationCommand(bob.id, group.conversation_id)
    )
    with pytest.raises(ConversationNotFoundError):
        await GetConversation(unit_of_work=factory).execute(
            GetConversationQuery(bob.id, group.conversation_id)
        )
