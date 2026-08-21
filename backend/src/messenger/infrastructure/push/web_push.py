"""Privacy-safe Web Push, APNs and FCM delivery."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Mapping
from typing import Any
from uuid import UUID

import httpx
import jwt
from pywebpush import WebPushException, webpush  # type: ignore[import-untyped]

from messenger.application.ports.push import (
    PushDeliveryConfiguration,
    PushEventType,
    PushNotification,
    PushUnitOfWorkFactory,
)
from messenger.domain.entities import PushProvider, PushSubscription

logger = logging.getLogger(__name__)


def _routing_payload(notification: PushNotification) -> dict[str, object]:
    return {
        "version": 1,
        "event_type": notification.event_type.value,
        "event_id": str(notification.event_id),
        "conversation_id": str(notification.conversation_id),
        "message_id": str(notification.message_id) if notification.message_id else None,
        "call_id": str(notification.call_id) if notification.call_id else None,
        "sync_required": True,
    }


def _subscription_info(subscription: PushSubscription) -> Mapping[str, Any]:
    if subscription.endpoint is None or subscription.p256dh is None or subscription.auth is None:
        raise RuntimeError("Web Push subscription is incomplete")
    return {
        "endpoint": subscription.endpoint,
        "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
    }


def _generic_copy(notification: PushNotification) -> tuple[str, str]:
    if notification.event_type is PushEventType.INCOMING_CALL:
        return "Входящий звонок", "Откройте yv-chat, чтобы ответить."
    return "Новое сообщение", "Откройте yv-chat, чтобы прочитать."


class WebPushNotifier:
    """Resolve active destinations and send bounded opaque routing hints."""

    def __init__(
        self,
        *,
        unit_of_work: PushUnitOfWorkFactory,
        configuration: PushDeliveryConfiguration,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._configuration = configuration
        self._apns_token: tuple[str, float] | None = None
        self._fcm_token: tuple[str, float] | None = None
        self._token_lock = asyncio.Lock()

    async def publish(self, notifications: tuple[PushNotification, ...]) -> None:
        if not notifications:
            return
        by_user = {notification.user_id: notification for notification in notifications}
        async with self._unit_of_work() as unit_of_work:
            subscriptions = await unit_of_work.subscriptions.list_for_users(set(by_user))
        subscriptions = [
            item for item in subscriptions if self._configuration.provider_enabled(item.provider)
        ]
        if not subscriptions:
            return

        semaphore = asyncio.Semaphore(4)
        timeout = httpx.Timeout(self._configuration.timeout_seconds)
        async with httpx.AsyncClient(http2=True, timeout=timeout) as client:

            async def deliver(subscription: PushSubscription) -> UUID | None:
                notification = by_user.get(subscription.user_id)
                if notification is None:
                    return None
                async with semaphore:
                    try:
                        if subscription.provider is PushProvider.WEB:
                            return await self._deliver_web(subscription, notification)
                        if subscription.provider is PushProvider.APNS:
                            return await self._deliver_apns(client, subscription, notification)
                        return await self._deliver_fcm(client, subscription, notification)
                    except (OSError, TimeoutError, httpx.HTTPError):
                        logger.warning(
                            "push transport unavailable",
                            extra={
                                "subscription_id": str(subscription.id),
                                "provider": subscription.provider.value,
                            },
                        )
                        return None

            permanently_invalid = {
                subscription_id
                for subscription_id in await asyncio.gather(
                    *(deliver(item) for item in subscriptions)
                )
                if subscription_id is not None
            }

        if permanently_invalid:
            async with self._unit_of_work() as unit_of_work:
                await unit_of_work.subscriptions.delete_by_ids(permanently_invalid)
                await unit_of_work.commit()

    async def _deliver_web(
        self, subscription: PushSubscription, notification: PushNotification
    ) -> UUID | None:
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info=_subscription_info(subscription),
                data=json.dumps(_routing_payload(notification), separators=(",", ":")),
                vapid_private_key=self._configuration.require_private_key(),
                vapid_claims={"sub": self._configuration.require_contact()},
                ttl=self._configuration.ttl_seconds,
                timeout=self._configuration.timeout_seconds,
            )
        except WebPushException as error:
            status_code = error.response.status_code if error.response is not None else None
            logger.warning(
                "web push delivery failed",
                extra={"subscription_id": str(subscription.id), "status_code": status_code},
            )
            return subscription.id if status_code in {404, 410} else None
        return None

    async def _deliver_apns(
        self,
        client: httpx.AsyncClient,
        subscription: PushSubscription,
        notification: PushNotification,
    ) -> UUID | None:
        token = subscription.native_token
        bundle_id = self._configuration.apns_bundle_id
        if token is None or bundle_id is None:
            raise RuntimeError("APNs destination/configuration is incomplete")
        title, body = _generic_copy(notification)
        payload = _routing_payload(notification)
        payload["aps"] = {
            "alert": {"title": title, "body": body},
            "sound": "default",
            "thread-id": str(notification.conversation_id),
            "content-available": 1,
        }
        host = (
            "https://api.sandbox.push.apple.com"
            if self._configuration.apns_use_sandbox
            else "https://api.push.apple.com"
        )
        response = await client.post(
            f"{host}/3/device/{token}",
            headers={
                "authorization": f"bearer {await self._apns_authorization()}",
                "apns-topic": bundle_id,
                "apns-push-type": "alert",
                "apns-priority": "10",
                "apns-expiration": str(int(time.time()) + self._configuration.ttl_seconds),
                "apns-collapse-id": str(notification.event_id),
            },
            json=payload,
        )
        if response.status_code == 200:
            return None
        reason = self._response_reason(response)
        logger.warning(
            "APNs delivery failed",
            extra={
                "subscription_id": str(subscription.id),
                "status_code": response.status_code,
                "reason": reason,
            },
        )
        return (
            subscription.id
            if response.status_code == 410
            or reason in {"BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"}
            else None
        )

    async def _apns_authorization(self) -> str:
        now = time.time()
        cached = self._apns_token
        if cached is not None and cached[1] > now:
            return cached[0]
        async with self._token_lock:
            cached = self._apns_token
            if cached is not None and cached[1] > now:
                return cached[0]
            key_id = self._configuration.apns_key_id
            team_id = self._configuration.apns_team_id
            private_key = self._configuration.apns_private_key
            if key_id is None or team_id is None or private_key is None:
                raise RuntimeError("APNs configuration is incomplete")
            encoded = jwt.encode(
                {"iss": team_id, "iat": int(now)},
                private_key,
                algorithm="ES256",
                headers={"kid": key_id},
            )
            self._apns_token = (encoded, now + 50 * 60)
            return encoded

    async def _deliver_fcm(
        self,
        client: httpx.AsyncClient,
        subscription: PushSubscription,
        notification: PushNotification,
    ) -> UUID | None:
        token = subscription.native_token
        project_id = self._configuration.fcm_project_id
        if token is None or project_id is None:
            raise RuntimeError("FCM destination/configuration is incomplete")
        title, body = _generic_copy(notification)
        routing = {
            key: str(value).lower() if isinstance(value, bool) else str(value)
            for key, value in _routing_payload(notification).items()
            if value is not None
        }
        incoming_call = notification.event_type is PushEventType.INCOMING_CALL
        response = await client.post(
            f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send",
            headers={"authorization": f"Bearer {await self._fcm_authorization(client)}"},
            json={
                "message": {
                    "token": token,
                    "notification": {"title": title, "body": body},
                    "data": routing,
                    "android": {
                        "priority": "high" if incoming_call else "normal",
                        "ttl": f"{self._configuration.ttl_seconds}s",
                        "notification": {
                            "channel_id": "yv_calls" if incoming_call else "yv_messages",
                            "tag": f"yv-{notification.event_id}",
                            "visibility": "PRIVATE",
                        },
                    },
                }
            },
        )
        if response.status_code == 200:
            return None
        error_code = self._fcm_error_code(response)
        logger.warning(
            "FCM delivery failed",
            extra={
                "subscription_id": str(subscription.id),
                "status_code": response.status_code,
                "reason": error_code,
            },
        )
        return subscription.id if error_code == "UNREGISTERED" else None

    async def _fcm_authorization(self, client: httpx.AsyncClient) -> str:
        now = time.time()
        cached = self._fcm_token
        if cached is not None and cached[1] > now:
            return cached[0]
        async with self._token_lock:
            cached = self._fcm_token
            if cached is not None and cached[1] > now:
                return cached[0]
            email = self._configuration.fcm_client_email
            private_key = self._configuration.fcm_private_key
            if email is None or private_key is None:
                raise RuntimeError("FCM configuration is incomplete")
            assertion = jwt.encode(
                {
                    "iss": email,
                    "scope": "https://www.googleapis.com/auth/firebase.messaging",
                    "aud": "https://oauth2.googleapis.com/token",
                    "iat": int(now),
                    "exp": int(now) + 3600,
                },
                private_key,
                algorithm="RS256",
            )
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
            response.raise_for_status()
            value: object = response.json()
            if not isinstance(value, dict):
                raise RuntimeError("FCM OAuth response is invalid")
            access_token_value = value.get("access_token")
            if not isinstance(access_token_value, str):
                raise RuntimeError("FCM OAuth response is invalid")
            expires_in = value.get("expires_in")
            lifetime = float(expires_in) if isinstance(expires_in, (int, float)) else 3600.0
            access_token = access_token_value
            self._fcm_token = (access_token, now + max(60.0, lifetime - 60.0))
            return access_token

    @staticmethod
    def _response_reason(response: httpx.Response) -> str | None:
        try:
            value: object = response.json()
        except ValueError:
            return None
        reason = value.get("reason") if isinstance(value, dict) else None
        return reason if isinstance(reason, str) else None

    @staticmethod
    def _fcm_error_code(response: httpx.Response) -> str | None:
        try:
            value: object = response.json()
        except ValueError:
            return None
        if not isinstance(value, dict):
            return None
        error = value.get("error")
        if not isinstance(error, dict):
            return None
        details = error.get("details")
        if not isinstance(details, list):
            return None
        for detail in details:
            error_code = detail.get("errorCode") if isinstance(detail, dict) else None
            if isinstance(error_code, str):
                return error_code
        return None
