"""Transport-independent conversation result DTOs."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.ports.identity import UserRepository
from messenger.domain.entities import Conversation, ConversationMemberRole, ConversationType


@dataclass(frozen=True, slots=True)
class ConversationMemberItem:
    user_id: UUID
    username: str
    display_name: str
    role: ConversationMemberRole
    joined_at: datetime
    left_at: datetime | None


@dataclass(frozen=True, slots=True)
class ConversationResult:
    conversation_id: UUID
    conversation_type: ConversationType
    title: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    members: tuple[ConversationMemberItem, ...]


async def build_conversation_result(
    conversation: Conversation,
    users: UserRepository,
) -> ConversationResult:
    return (await build_conversation_results([conversation], users))[0]


async def build_conversation_results(
    conversations: list[Conversation],
    users: UserRepository,
) -> list[ConversationResult]:
    if not conversations:
        return []
    referenced_user_ids = {
        member.user_id for conversation in conversations for member in conversation.members
    }
    loaded_users = await users.get_many_by_ids(referenced_user_ids)
    users_by_id = {user.id: user for user in loaded_users}
    if users_by_id.keys() != referenced_user_ids:
        raise RuntimeError("conversation references a missing user")
    return [
        ConversationResult(
            conversation_id=conversation.id,
            conversation_type=conversation.conversation_type,
            title=conversation.title,
            created_by=conversation.created_by,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            members=tuple(
                ConversationMemberItem(
                    user_id=member.user_id,
                    username=users_by_id[member.user_id].username,
                    display_name=users_by_id[member.user_id].display_name,
                    role=member.role,
                    joined_at=member.joined_at,
                    left_at=member.left_at,
                )
                for member in conversation.members
            ),
        )
        for conversation in conversations
    ]
