"""Dishka graph and scope characterization tests."""

from messenger.application.accounts.activate import ActivateAccount
from messenger.application.accounts.bootstrap_admin import BootstrapAdmin
from messenger.application.accounts.invite import CreateUserInvitation
from messenger.application.devices.list_security_events import ListSecurityEvents
from messenger.application.devices.list_sessions import ListMySessions
from messenger.application.devices.rename import RenameMyDevice
from messenger.application.devices.revoke import RevokeMyDevice
from messenger.application.devices.revoke_others import RevokeOtherSessions
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.application.sessions.login import Login
from messenger.application.sessions.logout import Logout
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
    finally:
        await container.close()

    assert tuple(type(operation) for operation in operations) == operation_types
