"""Device-management use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.devices.list_security_events import ListSecurityEvents
from messenger.application.devices.list_sessions import ListMySessions
from messenger.application.devices.rename import RenameMyDevice
from messenger.application.devices.revoke import RevokeMyDevice
from messenger.application.devices.revoke_others import RevokeOtherSessions


class DeviceUseCaseProvider(Provider):
    """Create focused active-device operations in request scope."""

    list_my_sessions = provide(ListMySessions, scope=Scope.REQUEST)
    list_security_events = provide(ListSecurityEvents, scope=Scope.REQUEST)
    rename_my_device = provide(RenameMyDevice, scope=Scope.REQUEST)
    revoke_my_device = provide(RevokeMyDevice, scope=Scope.REQUEST)
    revoke_other_sessions = provide(RevokeOtherSessions, scope=Scope.REQUEST)
