"""Web Push persistence and delivery boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from types import TracebackType
from typing import Protocol, Self
from uuid import UUID

from messenger.application.ports.identity import DeviceRepository
from messenger.domain.entities import PushProvider, PushSubscription


class PushSubscriptionRepository(Protocol):
    async def get_by_device(self, device_id: UUID) -> PushSubscription | None: ...

    async def get_by_destination(
        self, provider: PushProvider, destination: str
    ) -> PushSubscription | None: ...

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


class PushEventType(StrEnum):
    MESSAGE_CREATED = "message_created"
    INCOMING_CALL = "incoming_call"


@dataclass(frozen=True, slots=True)
class PushNotification:
    user_id: UUID
    event_id: UUID
    conversation_id: UUID
    message_id: UUID | None
    event_type: PushEventType = PushEventType.MESSAGE_CREATED
    call_id: UUID | None = None

    def __post_init__(self) -> None:
        if self.event_type is PushEventType.MESSAGE_CREATED:
            valid = self.message_id is not None and self.call_id is None
        else:
            valid = self.message_id is None and self.call_id is not None
        if not valid:
            raise ValueError("push notification shape does not match event type")


class PushNotifier(Protocol):
    async def publish(self, notifications: tuple[PushNotification, ...]) -> None: ...


@dataclass(frozen=True, slots=True)
class PushDeliveryConfiguration:
    enabled: bool
    private_key: str | None
    contact: str | None
    ttl_seconds: int
    timeout_seconds: float
    apns_key_id: str | None = None
    apns_team_id: str | None = None
    apns_bundle_id: str | None = None
    apns_private_key: str | None = None
    apns_use_sandbox: bool = False
    fcm_project_id: str | None = None
    fcm_client_email: str | None = None
    fcm_private_key: str | None = None

    def require_private_key(self) -> str:
        if not self.enabled or self.private_key is None:
            raise RuntimeError("Web Push is disabled")
        return self.private_key

    def require_contact(self) -> str:
        if not self.enabled or self.contact is None:
            raise RuntimeError("Web Push is disabled")
        return self.contact

    def provider_enabled(self, provider: PushProvider) -> bool:
        if provider is PushProvider.WEB:
            return self.enabled
        if provider is PushProvider.APNS:
            return self.apns_private_key is not None
        return self.fcm_private_key is not None
