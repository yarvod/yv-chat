"""Extend retained active data to the effective configured message policy."""

import asyncio
import logging

from messenger.application.messaging.extend_retention import ExtendExistingRetention
from messenger.bootstrap.container import create_container
from messenger.bootstrap.settings import AppSettings

logger = logging.getLogger("messenger.retention_reconciliation")


async def run() -> None:
    settings = AppSettings()
    container = create_container(settings)
    try:
        async with container() as request_scope:
            use_case = await request_scope.get(ExtendExistingRetention)
            result = await use_case.execute()
        logger.info(
            "retention reconciliation completed extended_messages=%d extended_attachments=%d",
            result.extended_messages,
            result.extended_attachments,
        )
    finally:
        await container.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    asyncio.run(run())


if __name__ == "__main__":
    main()
