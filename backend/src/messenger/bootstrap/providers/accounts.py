"""Account lifecycle use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.accounts.activate import ActivateAccount
from messenger.application.accounts.bootstrap_admin import BootstrapAdmin
from messenger.application.accounts.invite import CreateUserInvitation


class AccountUseCaseProvider(Provider):
    """Create one account operation object per request/command scope."""

    activate_account = provide(ActivateAccount, scope=Scope.REQUEST)
    bootstrap_admin = provide(BootstrapAdmin, scope=Scope.REQUEST)
    create_user_invitation = provide(CreateUserInvitation, scope=Scope.REQUEST)
