"""Privacy-safe VAPID Web Push delivery."""

import asyncio
import json
import logging
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from pywebpush import WebPushException, webpush  # type: ignore[import-untyped]

from messenger.application.ports.push import (
    PushDeliveryConfiguration,
    PushNotification,
    PushUnitOfWorkFactory,
)
from messenger.domain.entities import PushSubscription

logger = logging.getLogger(__name__)


def _subscription_info(subscription: PushSubscription) -> Mapping[str, Any]:
    return {
        "endpoint": subscription.endpoint,
        "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
    }


def _payload(notification: PushNotification) -> str:
    return json.dumps(
        {
            "version": 1,
            "event_type": notification.event_type,
            "event_id": str(notification.event_id),
            "conversation_id": str(notification.conversation_id),
            "message_id": str(notification.message_id) if notification.message_id else None,
            "call_id": str(notification.call_id) if notification.call_id else None,
            "sync_required": True,
        },
        separators=(",", ":"),
    )


class WebPushNotifier:
    """Resolve device subscriptions and send bounded opaque routing hints."""

    def __init__(
        self,
        *,
        unit_of_work: PushUnitOfWorkFactory,
        configuration: PushDeliveryConfiguration,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._configuration = configuration

    async def publish(self, notifications: tuple[PushNotification, ...]) -> None:
        if not self._configuration.enabled or not notifications:
            return
        by_user = {notification.user_id: notification for notification in notifications}
        async with self._unit_of_work() as unit_of_work:
            subscriptions = await unit_of_work.subscriptions.list_for_users(set(by_user))

        semaphore = asyncio.Semaphore(4)

        async def deliver(subscription: PushSubscription) -> UUID | None:
            notification = by_user.get(subscription.user_id)
            if notification is None:
                return None
            async with semaphore:
                try:
                    await asyncio.to_thread(
                        webpush,
                        subscription_info=_subscription_info(subscription),
                        data=_payload(notification),
                        vapid_private_key=self._configuration.require_private_key(),
                        vapid_claims={"sub": self._configuration.require_contact()},
                        ttl=self._configuration.ttl_seconds,
                        timeout=self._configuration.timeout_seconds,
                    )
                except WebPushException as error:
                    status_code = error.response.status_code if error.response is not None else None
                    logger.warning(
                        "web push delivery failed",
                        extra={
                            "subscription_id": str(subscription.id),
                            "status_code": status_code,
                        },
                    )
                    return subscription.id if status_code in {404, 410} else None
                except (OSError, TimeoutError):
                    logger.warning(
                        "web push transport unavailable",
                        extra={"subscription_id": str(subscription.id)},
                    )
            return None

        permanently_invalid = {
            subscription_id
            for subscription_id in await asyncio.gather(*(deliver(item) for item in subscriptions))
            if subscription_id is not None
        }

        if permanently_invalid:
            async with self._unit_of_work() as unit_of_work:
                await unit_of_work.subscriptions.delete_by_ids(permanently_invalid)
                await unit_of_work.commit()
