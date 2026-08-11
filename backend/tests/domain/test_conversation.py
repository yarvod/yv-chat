"""Conversation aggregate invariants."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.domain.entities import (
    Conversation,
    ConversationMemberRole,
    ConversationType,
)
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def test_direct_conversation_has_exactly_two_plain_members() -> None:
    creator_id = uuid4()
    other_id = uuid4()

    conversation = Conversation.create_direct(
        created_by=creator_id,
        other_user_id=other_id,
        now=NOW,
    )

    assert conversation.conversation_type is ConversationType.DIRECT
    assert conversation.title is None
    assert {member.user_id for member in conversation.members} == {
        creator_id,
        other_id,
    }
    assert all(member.role is ConversationMemberRole.MEMBER for member in conversation.members)


def test_direct_conversation_rejects_self_chat_and_membership_changes() -> None:
    user_id = uuid4()
    with pytest.raises(DomainValidationError, match="must be different"):
        Conversation.create_direct(created_by=user_id, other_user_id=user_id, now=NOW)

    conversation = Conversation.create_direct(
        created_by=user_id,
        other_user_id=uuid4(),
        now=NOW,
    )
    with pytest.raises(DomainValidationError, match="cannot be added"):
        conversation.add_member(uuid4(), NOW + timedelta(seconds=1))


def test_group_normalizes_title_and_owns_creator_membership() -> None:
    creator_id = uuid4()

    conversation = Conversation.create_group(
        created_by=creator_id,
        title="  Project room  ",
        now=NOW,
    )

    assert conversation.title == "Project room"
    assert conversation.members[0].user_id == creator_id
    assert conversation.members[0].role is ConversationMemberRole.OWNER


def test_group_member_can_join_and_leave_but_owner_cannot_leave() -> None:
    creator_id = uuid4()
    member_id = uuid4()
    conversation = Conversation.create_group(
        created_by=creator_id,
        title="Project room",
        now=NOW,
    )

    joined = conversation.add_member(member_id, NOW + timedelta(seconds=1))
    left = joined.remove_member(member_id, NOW + timedelta(seconds=2))

    assert left.member(member_id).left_at == NOW + timedelta(seconds=2)
    assert left.updated_at == NOW + timedelta(seconds=2)
    with pytest.raises(DomainValidationError, match="owner cannot leave"):
        left.remove_member(creator_id, NOW + timedelta(seconds=3))


def test_group_rejects_duplicate_members_and_invalid_timestamps() -> None:
    creator_id = uuid4()
    conversation = Conversation.create_group(
        created_by=creator_id,
        title="Project room",
        now=NOW,
    )

    with pytest.raises(DomainValidationError, match="already exists"):
        conversation.add_member(creator_id, NOW + timedelta(seconds=1))
    with pytest.raises(DomainValidationError, match="timezone-aware"):
        Conversation.create_group(
            created_by=creator_id,
            title="Project room",
            now=datetime(2026, 8, 11, 12, 0),
        )


def test_group_owner_changes_member_role_but_ownership_is_immutable() -> None:
    creator_id = uuid4()
    member_id = uuid4()
    conversation = Conversation.create_group(
        created_by=creator_id,
        title="Project room",
        now=NOW,
    ).add_member(member_id, NOW + timedelta(seconds=1))

    promoted = conversation.change_member_role(
        member_id,
        ConversationMemberRole.ADMIN,
        NOW + timedelta(seconds=2),
    )

    assert promoted.member(member_id).role is ConversationMemberRole.ADMIN
    with pytest.raises(DomainValidationError, match="ownership transfer"):
        promoted.change_member_role(
            member_id,
            ConversationMemberRole.OWNER,
            NOW + timedelta(seconds=3),
        )
    with pytest.raises(DomainValidationError, match="owner role"):
        promoted.change_member_role(
            creator_id,
            ConversationMemberRole.MEMBER,
            NOW + timedelta(seconds=3),
        )


def test_direct_membership_is_immutable() -> None:
    creator_id = uuid4()
    other_id = uuid4()
    conversation = Conversation.create_direct(
        created_by=creator_id,
        other_user_id=other_id,
        now=NOW,
    )

    with pytest.raises(DomainValidationError, match="cannot leave"):
        conversation.remove_member(other_id, NOW + timedelta(seconds=1))
    with pytest.raises(DomainValidationError, match="cannot be changed"):
        conversation.change_member_role(
            other_id,
            ConversationMemberRole.ADMIN,
            NOW + timedelta(seconds=1),
        )
