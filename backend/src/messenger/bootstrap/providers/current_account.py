"""Current-account self-service use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.accounts.change_password import ChangeCurrentPassword
from messenger.application.accounts.get_current import GetCurrentAccount
from messenger.application.accounts.security_reset import SecurityReset
from messenger.application.accounts.update_profile import UpdateCurrentProfile


class CurrentAccountUseCaseProvider(Provider):
    """Keep self-service account operations separate from admin lifecycle wiring."""

    get_current_account = provide(GetCurrentAccount, scope=Scope.REQUEST)
    update_current_profile = provide(UpdateCurrentProfile, scope=Scope.REQUEST)
    change_current_password = provide(ChangeCurrentPassword, scope=Scope.REQUEST)
    security_reset = provide(SecurityReset, scope=Scope.REQUEST)
