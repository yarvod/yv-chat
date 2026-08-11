"""Conversation aggregate and membership lifecycle invariants."""

from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from messenger.domain.entities._validation import (
    normalize_bounded_text,
    require_aware_datetime,
)
from messenger.domain.exceptions import DomainValidationError


class ConversationType(StrEnum):
    DIRECT = "direct"
    GROUP = "group"


class ConversationMemberRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


@dataclass(frozen=True, slots=True)
class ConversationMember:
    conversation_id: UUID
    user_id: UUID
    role: ConversationMemberRole
    joined_at: datetime
    left_at: datetime | None = None

    def __post_init__(self) -> None:
        require_aware_datetime(self.joined_at, "joined_at")
        if self.left_at is not None:
            require_aware_datetime(self.left_at, "left_at")
            if self.left_at < self.joined_at:
                raise DomainValidationError("left_at must not be before joined_at")

    @property
    def is_active(self) -> bool:
        return self.left_at is None

    def leave(self, now: datetime) -> "ConversationMember":
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.joined_at:
            raise DomainValidationError("left_at must not be before joined_at")
        if self.left_at is not None:
            return self
        return replace(self, left_at=timestamp)

    def change_role(self, role: ConversationMemberRole) -> "ConversationMember":
        if not self.is_active:
            raise DomainValidationError("inactive member role cannot be changed")
        return replace(self, role=role)


@dataclass(frozen=True, slots=True)
class Conversation:
    id: UUID
    conversation_type: ConversationType
    title: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    members: tuple[ConversationMember, ...]

    def __post_init__(self) -> None:
        require_aware_datetime(self.created_at, "created_at")
        require_aware_datetime(self.updated_at, "updated_at")
        if self.updated_at < self.created_at:
            raise DomainValidationError("updated_at must not be before created_at")
        if any(member.conversation_id != self.id for member in self.members):
            raise DomainValidationError("member conversation_id must match aggregate")
        member_ids = [member.user_id for member in self.members]
        if len(member_ids) != len(set(member_ids)):
            raise DomainValidationError("conversation members must be unique")
        creator = next(
            (member for member in self.members if member.user_id == self.created_by),
            None,
        )
        if creator is None or not creator.is_active:
            raise DomainValidationError("conversation creator must be an active member")

        if self.conversation_type is ConversationType.DIRECT:
            if self.title is not None:
                raise DomainValidationError("direct conversation must not have a title")
            if len(self.members) != 2:
                raise DomainValidationError("direct conversation requires exactly two members")
            if any(member.role is not ConversationMemberRole.MEMBER for member in self.members):
                raise DomainValidationError("direct conversation members must use member role")
        else:
            normalized_title = normalize_bounded_text(
                self.title or "",
                field_name="title",
                maximum_length=100,
            )
            if self.title != normalized_title:
                raise DomainValidationError("group title must be normalized")
            owners = [
                member
                for member in self.members
                if member.is_active and member.role is ConversationMemberRole.OWNER
            ]
            if len(owners) != 1 or owners[0].user_id != self.created_by:
                raise DomainValidationError("group creator must be the single active owner")

    @classmethod
    def create_direct(
        cls,
        *,
        created_by: UUID,
        other_user_id: UUID,
        now: datetime,
        conversation_id: UUID | None = None,
    ) -> "Conversation":
        if created_by == other_user_id:
            raise DomainValidationError("direct conversation users must be different")
        timestamp = require_aware_datetime(now, "now")
        identifier = conversation_id or uuid4()
        members = tuple(
            ConversationMember(
                conversation_id=identifier,
                user_id=user_id,
                role=ConversationMemberRole.MEMBER,
                joined_at=timestamp,
            )
            for user_id in (created_by, other_user_id)
        )
        return cls(
            id=identifier,
            conversation_type=ConversationType.DIRECT,
            title=None,
            created_by=created_by,
            created_at=timestamp,
            updated_at=timestamp,
            members=members,
        )

    @classmethod
    def create_group(
        cls,
        *,
        created_by: UUID,
        title: str,
        now: datetime,
        conversation_id: UUID | None = None,
    ) -> "Conversation":
        timestamp = require_aware_datetime(now, "now")
        identifier = conversation_id or uuid4()
        normalized_title = normalize_bounded_text(
            title,
            field_name="title",
            maximum_length=100,
        )
        owner = ConversationMember(
            conversation_id=identifier,
            user_id=created_by,
            role=ConversationMemberRole.OWNER,
            joined_at=timestamp,
        )
        return cls(
            id=identifier,
            conversation_type=ConversationType.GROUP,
            title=normalized_title,
            created_by=created_by,
            created_at=timestamp,
            updated_at=timestamp,
            members=(owner,),
        )

    def add_member(self, user_id: UUID, now: datetime) -> "Conversation":
        if self.conversation_type is not ConversationType.GROUP:
            raise DomainValidationError("members cannot be added to direct conversation")
        if any(member.user_id == user_id for member in self.members):
            raise DomainValidationError("conversation member already exists")
        timestamp = require_aware_datetime(now, "now")
        member = ConversationMember(
            conversation_id=self.id,
            user_id=user_id,
            role=ConversationMemberRole.MEMBER,
            joined_at=timestamp,
        )
        return replace(self, members=(*self.members, member), updated_at=timestamp)

    def remove_member(self, user_id: UUID, now: datetime) -> "Conversation":
        member = self.member(user_id)
        if member.role is ConversationMemberRole.OWNER:
            raise DomainValidationError("group owner cannot leave without ownership transfer")
        timestamp = require_aware_datetime(now, "now")
        return replace(
            self,
            members=tuple(
                item.leave(timestamp) if item.user_id == user_id else item for item in self.members
            ),
            updated_at=timestamp,
        )

    def member(self, user_id: UUID) -> ConversationMember:
        member = next((item for item in self.members if item.user_id == user_id), None)
        if member is None:
            raise DomainValidationError("conversation member does not exist")
        return member
