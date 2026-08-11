"""Conversation membership authorization policy."""

from uuid import UUID

from messenger.application.errors import (
    AuthorizationDeniedError,
    ConversationNotFoundError,
    SessionNotAuthenticatedError,
)
from messenger.application.ports.identity import UserRepository
from messenger.domain.entities import (
    Conversation,
    ConversationMember,
    ConversationMemberRole,
    ConversationType,
)


async def require_active_actor(users: UserRepository, actor_user_id: UUID) -> None:
    actor = await users.get_by_id(actor_user_id)
    if actor is None or not actor.is_active:
        raise SessionNotAuthenticatedError("current account is unavailable")


def require_active_membership(
    conversation: Conversation | None,
    actor_user_id: UUID,
) -> tuple[Conversation, ConversationMember]:
    if conversation is None:
        raise ConversationNotFoundError("conversation not found")
    member = conversation.active_member(actor_user_id)
    if member is None:
        raise ConversationNotFoundError("conversation not found")
    return conversation, member


def require_group_manager(
    conversation: Conversation,
    actor: ConversationMember,
) -> None:
    if conversation.conversation_type is not ConversationType.GROUP:
        raise AuthorizationDeniedError("direct conversation membership is immutable")
    if actor.role not in {ConversationMemberRole.OWNER, ConversationMemberRole.ADMIN}:
        raise AuthorizationDeniedError("group manager role required")
