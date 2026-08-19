"""Privacy-safe Web Push adapter behavior."""

import json
from base64 import urlsafe_b64encode
from datetime import UTC, datetime
from types import SimpleNamespace, TracebackType
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from pywebpush import WebPushException  # type: ignore[import-untyped]

from messenger.application.ports.push import (
    PushDeliveryConfiguration,
    PushNotification,
    PushUnitOfWorkFactory,
)
from messenger.domain.entities import PushSubscription
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
