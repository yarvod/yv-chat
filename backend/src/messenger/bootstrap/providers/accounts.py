"""Account lifecycle use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.accounts.activate import ActivateAccount
from messenger.application.accounts.bootstrap_admin import BootstrapAdmin
from messenger.application.accounts.create_registration_invitation import (
    CreateRegistrationInvitation,
)
from messenger.application.accounts.invite import CreateUserInvitation
from messenger.application.accounts.issue_password_reset import IssuePasswordReset
from messenger.application.accounts.list_directory import ListUserDirectory
from messenger.application.accounts.list_registration_invitations import (
    ListRegistrationInvitations,
)
from messenger.application.accounts.list_users import ListManagedUsers
from messenger.application.accounts.register_with_invitation import RegisterWithInvitation
from messenger.application.accounts.reissue_activation import ReissueActivation
from messenger.application.accounts.reset_password import ResetPasswordWithToken
from messenger.application.accounts.revoke_registration_invitation import (
    RevokeRegistrationInvitation,
)
from messenger.application.accounts.update_user import UpdateManagedUser


class AccountUseCaseProvider(Provider):
    """Create one account operation object per request/command scope."""

    activate_account = provide(ActivateAccount, scope=Scope.REQUEST)
    bootstrap_admin = provide(BootstrapAdmin, scope=Scope.REQUEST)
    create_user_invitation = provide(CreateUserInvitation, scope=Scope.REQUEST)
    create_registration_invitation = provide(CreateRegistrationInvitation, scope=Scope.REQUEST)
    list_user_directory = provide(ListUserDirectory, scope=Scope.REQUEST)
    list_managed_users = provide(ListManagedUsers, scope=Scope.REQUEST)
    list_registration_invitations = provide(ListRegistrationInvitations, scope=Scope.REQUEST)
    register_with_invitation = provide(RegisterWithInvitation, scope=Scope.REQUEST)
    revoke_registration_invitation = provide(RevokeRegistrationInvitation, scope=Scope.REQUEST)
    issue_password_reset = provide(IssuePasswordReset, scope=Scope.REQUEST)
    reset_password_with_token = provide(ResetPasswordWithToken, scope=Scope.REQUEST)
    reissue_activation = provide(ReissueActivation, scope=Scope.REQUEST)
    update_managed_user = provide(UpdateManagedUser, scope=Scope.REQUEST)
