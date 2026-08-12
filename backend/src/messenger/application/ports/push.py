"""Web Push persistence and delivery boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from types import TracebackType
from typing import Protocol, Self
from uuid import UUID

from messenger.application.ports.identity import DeviceRepository
from messenger.domain.entities import PushSubscription


class PushSubscriptionRepository(Protocol):
    async def get_by_device(self, device_id: UUID) -> PushSubscription | None: ...

    async def get_by_endpoint(self, endpoint: str) -> PushSubscription | None: ...

    async def list_for_users(self, user_ids: set[UUID]) -> list[PushSubscription]: ...

    async def upsert(self, subscription: PushSubscription) -> None: ...

    async def delete_by_device(self, device_id: UUID) -> None: ...

    async def delete_by_ids(self, subscription_ids: set[UUID]) -> None: ...


class PushUnitOfWork(Protocol):
    devices: DeviceRepository
    subscriptions: PushSubscriptionRepository

    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None: ...


class PushUnitOfWorkFactory(Protocol):
    def __call__(self) -> PushUnitOfWork: ...


@dataclass(frozen=True, slots=True)
class PushNotification:
    user_id: UUID
    event_id: UUID
    conversation_id: UUID
    message_id: UUID


class PushNotifier(Protocol):
    async def publish(self, notifications: tuple[PushNotification, ...]) -> None: ...


@dataclass(frozen=True, slots=True)
class PushDeliveryConfiguration:
    enabled: bool
    private_key: str | None
    contact: str | None
    ttl_seconds: int
    timeout_seconds: float

    def require_private_key(self) -> str:
        if not self.enabled or self.private_key is None:
            raise RuntimeError("Web Push is disabled")
        return self.private_key

    def require_contact(self) -> str:
        if not self.enabled or self.contact is None:
            raise RuntimeError("Web Push is disabled")
        return self.contact
