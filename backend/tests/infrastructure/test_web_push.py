"""Privacy-safe Web Push adapter behavior."""

import json
from base64 import urlsafe_b64encode
from datetime import UTC, datetime
from types import SimpleNamespace, TracebackType
from typing import Any, cast
from uuid import UUID, uuid4

import httpx
import pytest
from pywebpush import WebPushException  # type: ignore[import-untyped]

from messenger.application.ports.push import (
    PushDeliveryConfiguration,
    PushNotification,
    PushUnitOfWorkFactory,
)
from messenger.domain.entities import PushProvider, PushSubscription
from messenger.infrastructure.push.web_push import WebPushNotifier

NOW = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)
P256DH = urlsafe_b64encode(b"\x04" + b"p" * 64).decode().rstrip("=")
AUTH = urlsafe_b64encode(b"a" * 16).decode().rstrip("=")
PRIVATE_KEY = urlsafe_b64encode(b"k" * 32).decode().rstrip("=")


class SubscriptionRepository:
    def __init__(self, subscriptions: list[PushSubscription]) -> None:
        self.subscriptions = subscriptions
        self.deleted: set[UUID] = set()

    async def list_for_users(self, user_ids: set[UUID]) -> list[PushSubscription]:
        return [item for item in self.subscriptions if item.user_id in user_ids]

    async def delete_by_ids(self, subscription_ids: set[UUID]) -> None:
        self.deleted.update(subscription_ids)


class PushUnit:
    def __init__(self, repository: SubscriptionRepository) -> None:
        self.subscriptions = repository
        self.committed = False

    async def __aenter__(self) -> "PushUnit":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None

    async def commit(self) -> None:
        self.committed = True


class PushFactory:
    def __init__(self, repository: SubscriptionRepository) -> None:
        self.repository = repository
        self.units: list[PushUnit] = []

    def __call__(self) -> PushUnit:
        unit = PushUnit(self.repository)
        self.units.append(unit)
        return unit


def configuration() -> PushDeliveryConfiguration:
    return PushDeliveryConfiguration(
        enabled=True,
        private_key=PRIVATE_KEY,
        contact="mailto:admin@example.test",
        ttl_seconds=300,
        timeout_seconds=5,
        apns_key_id="ABCDEFGHIJ",
        apns_team_id="KLMNOPQRST",
        apns_bundle_id="ru.yoowee.chat",
        apns_private_key="unused-in-transport-test",
        fcm_project_id="yv-chat-test",
        fcm_client_email="push@example.test",
        fcm_private_key="unused-in-transport-test",
    )


async def test_adapter_sends_only_opaque_routing_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    subscription = PushSubscription.create(
        user_id=user_id,
        device_id=uuid4(),
        endpoint="https://push.example.test/send/token",
        p256dh=P256DH,
        auth=AUTH,
        now=NOW,
    )
    repository = SubscriptionRepository([subscription])
    factory = PushFactory(repository)
    captured: dict[str, Any] = {}

    def fake_webpush(**kwargs: Any) -> object:
        captured.update(kwargs)
        return object()

    monkeypatch.setattr("messenger.infrastructure.push.web_push.webpush", fake_webpush)
    notification = PushNotification(user_id, uuid4(), uuid4(), uuid4())
    await WebPushNotifier(
        unit_of_work=cast(PushUnitOfWorkFactory, factory),
        configuration=configuration(),
    ).publish((notification,))

    payload = json.loads(cast(str, captured["data"]))
    assert payload == {
        "version": 1,
        "event_type": "message_created",
        "event_id": str(notification.event_id),
        "conversation_id": str(notification.conversation_id),
        "message_id": str(notification.message_id),
        "call_id": None,
        "sync_required": True,
    }
    serialized = json.dumps(payload)
    assert "plaintext" not in serialized
    assert "sender" not in serialized
    assert "ciphertext" not in serialized
    assert subscription.endpoint is not None
    assert subscription.endpoint not in serialized
    assert repository.deleted == set()


async def test_adapter_deletes_only_permanently_gone_subscription(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    subscription = PushSubscription.create(
        user_id=user_id,
        device_id=uuid4(),
        endpoint="https://push.example.test/send/gone",
        p256dh=P256DH,
        auth=AUTH,
        now=NOW,
    )
    repository = SubscriptionRepository([subscription])
    factory = PushFactory(repository)

    def gone(**kwargs: Any) -> object:
        del kwargs
        raise WebPushException(
            "gone",
            response=SimpleNamespace(status_code=410),
        )

    monkeypatch.setattr("messenger.infrastructure.push.web_push.webpush", gone)
    await WebPushNotifier(
        unit_of_work=cast(PushUnitOfWorkFactory, factory),
        configuration=configuration(),
    ).publish((PushNotification(user_id, uuid4(), uuid4(), uuid4()),))

    assert repository.deleted == {subscription.id}
    assert factory.units[-1].committed is True


class RecordingClient:
    def __init__(self, responses: list[httpx.Response]) -> None:
        self.responses = responses
        self.requests: list[dict[str, Any]] = []

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        self.requests.append({"url": url, **kwargs})
        return self.responses.pop(0)


async def test_native_adapters_send_generic_opaque_payloads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    notification = PushNotification(user_id, uuid4(), uuid4(), uuid4())
    apns = PushSubscription.create_native(
        user_id=user_id,
        device_id=uuid4(),
        provider=PushProvider.APNS,
        token="a" * 64,
        now=NOW,
    )
    fcm = PushSubscription.create_native(
        user_id=user_id,
        device_id=uuid4(),
        provider=PushProvider.FCM,
        token="fcm:" + "t" * 64,
        now=NOW,
    )
    notifier = WebPushNotifier(
        unit_of_work=cast(PushUnitOfWorkFactory, PushFactory(SubscriptionRepository([]))),
        configuration=configuration(),
    )

    async def authorization() -> str:
        return "provider-token"

    monkeypatch.setattr(notifier, "_apns_authorization", authorization)
    monkeypatch.setattr(notifier, "_fcm_authorization", lambda client: authorization())
    client = RecordingClient(
        [
            httpx.Response(200, request=httpx.Request("POST", "https://api.push.apple.com")),
            httpx.Response(200, request=httpx.Request("POST", "https://fcm.googleapis.com")),
        ]
    )

    assert await notifier._deliver_apns(cast(httpx.AsyncClient, client), apns, notification) is None
    assert await notifier._deliver_fcm(cast(httpx.AsyncClient, client), fcm, notification) is None

    apns_payload = client.requests[0]["json"]
    fcm_payload = client.requests[1]["json"]["message"]
    serialized = json.dumps(
        [
            apns_payload,
            {key: value for key, value in fcm_payload.items() if key != "token"},
        ]
    )
    assert apns_payload["aps"]["alert"] == {
        "title": "Новое сообщение",
        "body": "Откройте yv-chat, чтобы прочитать.",
    }
    assert fcm_payload["notification"]["title"] == "Новое сообщение"
    assert fcm_payload["data"]["conversation_id"] == str(notification.conversation_id)
    assert "sender" not in serialized
    assert "plaintext" not in serialized
    assert apns.native_token is not None
    assert fcm.native_token is not None
    assert apns.native_token not in serialized
    assert fcm.native_token not in serialized


async def test_native_adapter_marks_only_explicitly_invalid_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    subscription = PushSubscription.create_native(
        user_id=user_id,
        device_id=uuid4(),
        provider=PushProvider.FCM,
        token="fcm:" + "g" * 64,
        now=NOW,
    )
    notifier = WebPushNotifier(
        unit_of_work=cast(PushUnitOfWorkFactory, PushFactory(SubscriptionRepository([]))),
        configuration=configuration(),
    )

    async def authorization(client: httpx.AsyncClient) -> str:
        del client
        return "provider-token"

    monkeypatch.setattr(notifier, "_fcm_authorization", authorization)
    response = httpx.Response(
        404,
        json={"error": {"details": [{"errorCode": "UNREGISTERED"}]}},
        request=httpx.Request("POST", "https://fcm.googleapis.com"),
    )
    client = RecordingClient([response])

    result = await notifier._deliver_fcm(
        cast(httpx.AsyncClient, client),
        subscription,
        PushNotification(user_id, uuid4(), uuid4(), uuid4()),
    )
    assert result == subscription.id
