"""Web Push subscription invariants."""

from base64 import urlsafe_b64encode
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from messenger.domain.entities import PushProvider, PushSubscription
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)
P256DH = urlsafe_b64encode(b"\x04" + b"p" * 64).decode().rstrip("=")
AUTH = urlsafe_b64encode(b"a" * 16).decode().rstrip("=")


def test_subscription_accepts_bounded_https_material_and_refreshes_identity() -> None:
    subscription = PushSubscription.create(
        user_id=uuid4(),
        device_id=uuid4(),
        endpoint="https://push.example.test/send/token?version=1",
        p256dh=P256DH,
        auth=AUTH,
        now=NOW,
    )
    refreshed = subscription.refresh(
        endpoint="https://push.example.test/send/new-token",
        p256dh=P256DH,
        auth=AUTH,
        now=NOW + timedelta(minutes=1),
    )

    assert refreshed.id == subscription.id
    assert refreshed.device_id == subscription.device_id
    assert refreshed.created_at == NOW
    assert refreshed.updated_at == NOW + timedelta(minutes=1)


@pytest.mark.parametrize(
    ("endpoint", "p256dh", "auth"),
    [
        ("http://push.example.test/token", P256DH, AUTH),
        ("https://user:password@push.example.test/token", P256DH, AUTH),
        ("https://push.example.test/token#secret", P256DH, AUTH),
        ("https://push.example.test/token", "short", AUTH),
        ("https://push.example.test/token", P256DH, "short"),
    ],
)
def test_subscription_rejects_untrusted_or_malformed_material(
    endpoint: str,
    p256dh: str,
    auth: str,
) -> None:
    with pytest.raises(DomainValidationError):
        PushSubscription.create(
            user_id=uuid4(),
            device_id=uuid4(),
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            now=NOW,
        )


def test_native_subscription_accepts_provider_specific_tokens() -> None:
    apns = PushSubscription.create_native(
        user_id=uuid4(),
        device_id=uuid4(),
        provider=PushProvider.APNS,
        token="a" * 64,
        now=NOW,
    )
    refreshed = apns.refresh_native(
        provider=PushProvider.FCM,
        token="fcm:" + "t" * 64,
        now=NOW + timedelta(minutes=1),
    )

    assert apns.destination == "a" * 64
    assert refreshed.provider is PushProvider.FCM
    assert refreshed.endpoint is None
    assert refreshed.destination == "fcm:" + "t" * 64


@pytest.mark.parametrize(
    ("provider", "token"),
    [
        (PushProvider.APNS, "not-hex"),
        (PushProvider.FCM, "short"),
        (PushProvider.FCM, "x" * 32 + " token"),
    ],
)
def test_native_subscription_rejects_malformed_tokens(provider: PushProvider, token: str) -> None:
    with pytest.raises(DomainValidationError):
        PushSubscription.create_native(
            user_id=uuid4(),
            device_id=uuid4(),
            provider=provider,
            token=token,
            now=NOW,
        )
