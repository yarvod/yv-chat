"""Account lifecycle use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.accounts.activate import ActivateAccount
from messenger.application.accounts.bootstrap_admin import BootstrapAdmin
from messenger.application.accounts.invite import CreateUserInvitation
from messenger.application.accounts.list_directory import ListUserDirectory
from messenger.application.accounts.list_users import ListManagedUsers
from messenger.application.accounts.reissue_activation import ReissueActivation
from messenger.application.accounts.update_user import UpdateManagedUser


class AccountUseCaseProvider(Provider):
    """Create one account operation object per request/command scope."""

    activate_account = provide(ActivateAccount, scope=Scope.REQUEST)
    bootstrap_admin = provide(BootstrapAdmin, scope=Scope.REQUEST)
    create_user_invitation = provide(CreateUserInvitation, scope=Scope.REQUEST)
    list_user_directory = provide(ListUserDirectory, scope=Scope.REQUEST)
    list_managed_users = provide(ListManagedUsers, scope=Scope.REQUEST)
    reissue_activation = provide(ReissueActivation, scope=Scope.REQUEST)
    update_managed_user = provide(UpdateManagedUser, scope=Scope.REQUEST)
