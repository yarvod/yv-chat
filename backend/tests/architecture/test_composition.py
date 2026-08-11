"""Dishka graph and scope characterization tests."""

from messenger.application.accounts.activate import ActivateAccount
from messenger.application.accounts.bootstrap_admin import BootstrapAdmin
from messenger.application.accounts.change_password import ChangeCurrentPassword
from messenger.application.accounts.get_current import GetCurrentAccount
from messenger.application.accounts.invite import CreateUserInvitation
from messenger.application.accounts.issue_password_reset import IssuePasswordReset
from messenger.application.accounts.list_directory import ListUserDirectory
from messenger.application.accounts.list_users import ListManagedUsers
from messenger.application.accounts.reissue_activation import ReissueActivation
from messenger.application.accounts.reset_password import ResetPasswordWithToken
from messenger.application.accounts.security_reset import SecurityReset
from messenger.application.accounts.update_profile import UpdateCurrentProfile
from messenger.application.accounts.update_user import UpdateManagedUser
from messenger.application.conversation_crypto import (
    AcknowledgeConversationCryptoWelcome,
    BeginConversationCrypto,
    FinalizeConversationCrypto,
    GetCurrentConversationCrypto,
)
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
from messenger.application.devices.list_security_events import ListSecurityEvents
from messenger.application.devices.list_sessions import ListMySessions
from messenger.application.devices.rename import RenameMyDevice
from messenger.application.devices.revoke import RevokeMyDevice
from messenger.application.devices.revoke_others import RevokeOtherSessions
from messenger.application.messaging.get_message import GetMessage
from messenger.application.messaging.list_message_history import ListMessageHistory
from messenger.application.messaging.list_messages import ListMessages
from messenger.application.messaging.send_message import SendOpaqueMessage
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWorkFactory
from messenger.application.ports.conversations import ConversationUnitOfWorkFactory
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.sync import SyncUnitOfWorkFactory
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.application.sessions.login import Login
from messenger.application.sessions.logout import Logout
from messenger.application.sync.list_events import ListSyncEvents
from messenger.bootstrap.container import create_container
from messenger.bootstrap.settings import AppEnvironment, AppSettings


async def test_production_graph_resolves_every_application_operation() -> None:
    settings = AppSettings(
        app_env=AppEnvironment.TEST,
        database_url="postgresql+asyncpg://test:test@127.0.0.1:5432/test",
        allowed_origins=["https://test"],
    )
    container = create_container(settings)
    operation_types = (
        ActivateAccount,
        BootstrapAdmin,
        CreateUserInvitation,
        IssuePasswordReset,
        ListUserDirectory,
        ListManagedUsers,
        ReissueActivation,
        ResetPasswordWithToken,
        UpdateManagedUser,
        GetCurrentAccount,
        UpdateCurrentProfile,
        ChangeCurrentPassword,
        SecurityReset,
        CreateDirectConversation,
        CreateGroupConversation,
        ListConversations,
        GetConversation,
        AddConversationMember,
        RemoveConversationMember,
        RenameGroupConversation,
        LeaveConversation,
        ChangeConversationMemberRole,
        BeginConversationCrypto,
        FinalizeConversationCrypto,
        GetCurrentConversationCrypto,
        AcknowledgeConversationCryptoWelcome,
        SendOpaqueMessage,
        GetMessage,
        ListMessages,
        ListMessageHistory,
        ListSyncEvents,
        Login,
        AuthenticateSession,
        Logout,
        ListMySessions,
        ListSecurityEvents,
        RenameMyDevice,
        RevokeMyDevice,
        RevokeOtherSessions,
    )

    try:
        async with container() as request_container:
            operations = [
                await request_container.get(operation_type) for operation_type in operation_types
            ]
            conversation_unit_of_work = await request_container.get(ConversationUnitOfWorkFactory)
            conversation_crypto_unit_of_work = await request_container.get(
                ConversationCryptoUnitOfWorkFactory
            )
            messaging_unit_of_work = await request_container.get(MessagingUnitOfWorkFactory)
            sync_unit_of_work = await request_container.get(SyncUnitOfWorkFactory)
    finally:
        await container.close()

    assert tuple(type(operation) for operation in operations) == operation_types
    assert conversation_unit_of_work() is not None
    assert conversation_crypto_unit_of_work() is not None
    assert messaging_unit_of_work() is not None
    assert sync_unit_of_work() is not None
