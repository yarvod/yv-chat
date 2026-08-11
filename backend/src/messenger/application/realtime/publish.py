"""Best-effort post-commit realtime dispatch."""

import logging

from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.realtime.events import RealtimeNotification

logger = logging.getLogger(__name__)


async def publish_best_effort(
    notifier: RealtimeNotifier,
    notifications: tuple[RealtimeNotification, ...],
) -> None:
    """Never let an ephemeral delivery failure change committed durable state."""
    try:
        await notifier.publish(notifications)
    except Exception:
        logger.warning(
            "realtime notification dispatch failed",
            extra={"notification_count": len(notifications)},
        )
