"""Best-effort privacy-safe push dispatch."""

import logging

from messenger.application.ports.push import PushNotification, PushNotifier

logger = logging.getLogger(__name__)


async def publish_push_best_effort(
    notifier: PushNotifier,
    notifications: tuple[PushNotification, ...],
) -> None:
    if not notifications:
        return
    try:
        await notifier.publish(notifications)
    except Exception:
        logger.warning(
            "push notification dispatch failed",
            extra={"notification_count": len(notifications)},
        )
