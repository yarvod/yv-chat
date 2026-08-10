"""One-time initial administrator command-line entry point."""

import asyncio

from messenger.application.errors import BootstrapAlreadyCompletedError
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.use_cases.bootstrap_admin import BootstrapAdmin, BootstrapAdminCommand
from messenger.bootstrap.settings import AdminBootstrapSettings, AppSettings
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.clock import SystemClock
from messenger.infrastructure.persistence.database import create_engine, create_session_factory
from messenger.infrastructure.persistence.identity_uow import SqlAlchemyIdentityUnitOfWork


async def bootstrap() -> None:
    """Create the initial administrator without printing credentials."""
    app_settings = AppSettings()
    admin_settings = AdminBootstrapSettings()
    engine = create_engine(app_settings.database_url)
    session_factory = create_session_factory(engine)

    def unit_of_work() -> IdentityUnitOfWork:
        return SqlAlchemyIdentityUnitOfWork(session_factory)

    use_case = BootstrapAdmin(
        unit_of_work=unit_of_work,
        clock=SystemClock(),
        passwords=Argon2PasswordHasher(),
    )
    command = BootstrapAdminCommand(
        username=admin_settings.admin_username,
        display_name=admin_settings.admin_display_name,
        password=admin_settings.admin_password.get_secret_value(),
    )

    try:
        result = await use_case.execute(command)
    except BootstrapAlreadyCompletedError as error:
        raise SystemExit(str(error)) from error
    finally:
        await engine.dispose()

    print(f"Initial administrator created: {result.username} ({result.user_id})")


def main() -> None:
    """Run bootstrap from `python -m messenger.bootstrap_admin`."""
    asyncio.run(bootstrap())


if __name__ == "__main__":
    main()
