"""Run bounded message retention cleanup as an isolated low-resource process."""

import asyncio
import logging

from messenger.application.attachments.cleanup import CleanupExpiredAttachments
from messenger.application.messaging.cleanup_messages import CleanupExpiredMessages
from messenger.bootstrap.container import create_container
from messenger.bootstrap.settings import AppSettings

logger = logging.getLogger("messenger.message_cleanup")


async def run() -> None:
    settings = AppSettings()
    container = create_container(settings)
    try:
        while True:
            async with container() as request_scope:
                cleanup = await request_scope.get(CleanupExpiredMessages)
                result = await cleanup.execute()
                media_cleanup = await request_scope.get(CleanupExpiredAttachments)
                media_result = await media_cleanup.execute()
            logger.info(
                "retention cleanup completed expired_messages=%d purged_tombstones=%d "
                "deleted_attachments=%d",
                result.expired_messages,
                result.purged_tombstones,
                media_result.deleted_attachments,
            )
            await asyncio.sleep(settings.message_cleanup_interval_seconds)
    finally:
        await container.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    asyncio.run(run())


if __name__ == "__main__":
    main()
