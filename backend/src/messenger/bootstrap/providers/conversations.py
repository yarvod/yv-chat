"""Conversation use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.conversations.add_member import AddConversationMember
from messenger.application.conversations.change_member_role import (
    ChangeConversationMemberRole,
)
from messenger.application.conversations.create_direct import CreateDirectConversation
from messenger.application.conversations.create_group import CreateGroupConversation
from messenger.application.conversations.get_conversation import GetConversation
from messenger.application.conversations.leave_conversation import LeaveConversation
from messenger.application.conversations.list_conversations import ListConversations
from messenger.application.conversations.remove_member import RemoveConversationMember
from messenger.application.conversations.rename_group import RenameGroupConversation


class ConversationUseCaseProvider(Provider):
    """Create focused conversation operations in request scope."""

    create_direct_conversation = provide(CreateDirectConversation, scope=Scope.REQUEST)
    create_group_conversation = provide(CreateGroupConversation, scope=Scope.REQUEST)
    list_conversations = provide(ListConversations, scope=Scope.REQUEST)
    get_conversation = provide(GetConversation, scope=Scope.REQUEST)
    add_conversation_member = provide(AddConversationMember, scope=Scope.REQUEST)
    remove_conversation_member = provide(RemoveConversationMember, scope=Scope.REQUEST)
    rename_group_conversation = provide(RenameGroupConversation, scope=Scope.REQUEST)
    leave_conversation = provide(LeaveConversation, scope=Scope.REQUEST)
    change_conversation_member_role = provide(
        ChangeConversationMemberRole,
        scope=Scope.REQUEST,
    )
