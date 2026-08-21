"""Current-device Push subscription use-case specifications."""

from base64 import urlsafe_b64encode
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from types import TracebackType
from uuid import UUID, uuid4

import pytest

from messenger.application.errors import (
    AuthorizationDeniedError,
    PushSubscriptionConflictError,
)
from messenger.application.ports.identity import DeviceRepository
from messenger.application.ports.push import (
    PushSubscriptionRepository,
    PushUnitOfWork,
)
from messenger.application.push.manage_subscription import (
    CurrentPushSubscriptionQuery,
    GetCurrentPushSubscription,
    RegisterPushSubscription,
    RegisterPushSubscriptionCommand,
    RemovePushSubscription,
    RemovePushSubscriptionCommand,
)
from messenger.domain.entities import Device, PushProvider, PushSubscription
from tests.application.fakes import FixedClock

NOW = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)
P256DH = urlsafe_b64encode(b"\x04" + b"p" * 64).decode().rstrip("=")
AUTH = urlsafe_b64encode(b"a" * 16).decode().rstrip("=")


@dataclass(slots=True)
class PushState:
    devices: dict[UUID, Device] = field(default_factory=dict)
    subscriptions: dict[UUID, PushSubscription] = field(default_factory=dict)
    commits: int = 0


class FakeDevices:
    def __init__(self, state: PushState) -> None:
        self._state = state

    async def get_owned_by_id(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
        for_update: bool = False,
    ) -> Device | None:
        del for_update
        device = self._state.devices.get(device_id)
        return device if device is not None and device.user_id == user_id else None

    async def get_by_id(self, device_id: UUID, *, for_update: bool = False) -> Device | None:
        del for_update
        return self._state.devices.get(device_id)

    async def list_active_for_users(self, user_ids: set[UUID]) -> list[Device]:
        return [
            device
            for device in self._state.devices.values()
            if device.user_id in user_ids and device.revoked_at is None
        ]

    async def add(self, device: Device) -> None:
        self._state.devices[device.id] = device

    async def update(self, device: Device) -> None:
        self._state.devices[device.id] = device


class FakeSubscriptions:
    def __init__(self, state: PushState) -> None:
        self._state = state

    async def get_by_device(self, device_id: UUID) -> PushSubscription | None:
        return next(
            (item for item in self._state.subscriptions.values() if item.device_id == device_id),
            None,
        )

    async def get_by_destination(
        self, provider: PushProvider, destination: str
    ) -> PushSubscription | None:
        return next(
            (
                item
                for item in self._state.subscriptions.values()
                if item.provider is provider and item.destination == destination
            ),
            None,
        )

    async def list_for_users(self, user_ids: set[UUID]) -> list[PushSubscription]:
        return [item for item in self._state.subscriptions.values() if item.user_id in user_ids]

    async def upsert(self, subscription: PushSubscription) -> None:
        self._state.subscriptions[subscription.id] = subscription

    async def delete_by_device(self, device_id: UUID) -> None:
        self._state.subscriptions = {
            item_id: item
            for item_id, item in self._state.subscriptions.items()
            if item.device_id != device_id
        }

    async def delete_by_ids(self, subscription_ids: set[UUID]) -> None:
        for subscription_id in subscription_ids:
            self._state.subscriptions.pop(subscription_id, None)


class FakePushUnitOfWork:
    def __init__(self, state: PushState) -> None:
        self._state = state
        self.devices: DeviceRepository = FakeDevices(state)
        self.subscriptions: PushSubscriptionRepository = FakeSubscriptions(state)

    async def __aenter__(self) -> "FakePushUnitOfWork":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None

    async def commit(self) -> None:
        self._state.commits += 1


class FakePushUnitOfWorkFactory:
    def __init__(self, state: PushState) -> None:
        self._state = state

    def __call__(self) -> PushUnitOfWork:
        return FakePushUnitOfWork(self._state)


async def test_register_refresh_status_and_remove_current_device_subscription() -> None:
    user_id = uuid4()
    device = Device.create(user_id=user_id, name="Browser", now=NOW)
    state = PushState(devices={device.id: device})
    factory = FakePushUnitOfWorkFactory(state)
    register = RegisterPushSubscription(
        unit_of_work=factory,
        clock=FixedClock(NOW),
    )
    command = RegisterPushSubscriptionCommand(
        user_id=user_id,
        device_id=device.id,
        endpoint="https://push.example.test/send/one",
        p256dh=P256DH,
        auth=AUTH,
    )

    await register.execute(command)
    first = next(iter(state.subscriptions.values()))
    assert (
        await GetCurrentPushSubscription(unit_of_work=factory).execute(
            CurrentPushSubscriptionQuery(user_id, device.id)
        )
    ).registered is True

    await RegisterPushSubscription(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(minutes=1)),
    ).execute(command)
    assert len(state.subscriptions) == 1
    assert next(iter(state.subscriptions.values())).id == first.id

    await RemovePushSubscription(unit_of_work=factory).execute(
        RemovePushSubscriptionCommand(user_id, device.id)
    )
    assert state.subscriptions == {}
    assert state.commits == 3


async def test_registration_rejects_foreign_revoked_and_reused_endpoint() -> None:
    alice_id = uuid4()
    bob_id = uuid4()
    alice = Device.create(user_id=alice_id, name="Alice", now=NOW)
    bob = Device.create(user_id=bob_id, name="Bob", now=NOW)
    existing = PushSubscription.create(
        user_id=bob_id,
        device_id=bob.id,
        endpoint="https://push.example.test/send/shared",
        p256dh=P256DH,
        auth=AUTH,
        now=NOW,
    )
    state = PushState(
        devices={alice.id: alice, bob.id: bob},
        subscriptions={existing.id: existing},
    )
    use_case = RegisterPushSubscription(
        unit_of_work=FakePushUnitOfWorkFactory(state),
        clock=FixedClock(NOW + timedelta(seconds=1)),
    )

    with pytest.raises(AuthorizationDeniedError):
        await use_case.execute(
            RegisterPushSubscriptionCommand(
                user_id=alice_id,
                device_id=bob.id,
                endpoint="https://push.example.test/send/new",
                p256dh=P256DH,
                auth=AUTH,
            )
        )
    with pytest.raises(PushSubscriptionConflictError):
        await use_case.execute(
            RegisterPushSubscriptionCommand(
                user_id=alice_id,
                device_id=alice.id,
                endpoint=existing.endpoint,
                p256dh=P256DH,
                auth=AUTH,
            )
        )
    state.devices[alice.id] = alice.revoke(NOW + timedelta(seconds=1))
    with pytest.raises(AuthorizationDeniedError):
        await use_case.execute(
            RegisterPushSubscriptionCommand(
                user_id=alice_id,
                device_id=alice.id,
                endpoint="https://push.example.test/send/new",
                p256dh=P256DH,
                auth=AUTH,
            )
        )

    state.devices[alice.id] = alice
    state.devices[bob.id] = bob.revoke(NOW + timedelta(seconds=1))
    await use_case.execute(
        RegisterPushSubscriptionCommand(
            user_id=alice_id,
            device_id=alice.id,
            endpoint=existing.endpoint,
            p256dh=P256DH,
            auth=AUTH,
        )
    )
    assert len(state.subscriptions) == 1
    assert next(iter(state.subscriptions.values())).device_id == alice.id


async def test_native_registration_rotates_provider_token_on_the_same_device() -> None:
    user_id = uuid4()
    device = Device.create(user_id=user_id, name="Phone", now=NOW)
    state = PushState(devices={device.id: device})
    factory = FakePushUnitOfWorkFactory(state)

    await RegisterPushSubscription(unit_of_work=factory, clock=FixedClock(NOW)).execute(
        RegisterPushSubscriptionCommand(
            user_id=user_id,
            device_id=device.id,
            provider=PushProvider.APNS,
            token="a" * 64,
        )
    )
    first = next(iter(state.subscriptions.values()))
    status = await GetCurrentPushSubscription(unit_of_work=factory).execute(
        CurrentPushSubscriptionQuery(user_id, device.id)
    )
    assert status.provider is PushProvider.APNS

    await RegisterPushSubscription(
        unit_of_work=factory,
        clock=FixedClock(NOW + timedelta(minutes=1)),
    ).execute(
        RegisterPushSubscriptionCommand(
            user_id=user_id,
            device_id=device.id,
            provider=PushProvider.FCM,
            token="fcm:" + "n" * 64,
        )
    )
    refreshed = next(iter(state.subscriptions.values()))
    assert refreshed.id == first.id
    assert refreshed.provider is PushProvider.FCM
    assert refreshed.endpoint is None
