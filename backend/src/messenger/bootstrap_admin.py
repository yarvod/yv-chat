"""One-time initial administrator command-line entry point."""

import asyncio

from messenger.application.accounts.bootstrap_admin import BootstrapAdmin, BootstrapAdminCommand
from messenger.application.errors import BootstrapAlreadyCompletedError
from messenger.bootstrap.container import create_container
from messenger.bootstrap.settings import AdminBootstrapSettings, AppSettings


async def bootstrap() -> None:
    """Create the initial administrator without printing credentials."""
    app_settings = AppSettings()
    admin_settings = AdminBootstrapSettings()
    container = create_container(app_settings)
    command = BootstrapAdminCommand(
        username=admin_settings.admin_username,
        display_name=admin_settings.admin_display_name,
        password=admin_settings.admin_password.get_secret_value(),
    )

    try:
        async with container() as request_container:
            use_case = await request_container.get(BootstrapAdmin)
            result = await use_case.execute(command)
    except BootstrapAlreadyCompletedError as error:
        raise SystemExit(str(error)) from error
    finally:
        await container.close()

    print(f"Initial administrator created: {result.username} ({result.user_id})")


def main() -> None:
    """Run bootstrap from `python -m messenger.bootstrap_admin`."""
    asyncio.run(bootstrap())


if __name__ == "__main__":
    main()
