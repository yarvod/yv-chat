"""Atomic public device-identity registration boundary."""

from types import TracebackType
from typing import Protocol, Self

from messenger.application.ports.conversations import ConversationRepository
from messenger.application.ports.device_crypto.repositories import (
    DeviceCryptoIdentityRepository,
    DeviceKeyPackageRepository,
)
from messenger.application.ports.identity.devices import DeviceRepository
from messenger.application.ports.sync import SyncRepository


class DeviceCryptoUnitOfWork(Protocol):
    devices: DeviceRepository
    conversations: ConversationRepository
    identities: DeviceCryptoIdentityRepository
    key_packages: DeviceKeyPackageRepository
    sync_events: SyncRepository

    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None: ...


class DeviceCryptoUnitOfWorkFactory(Protocol):
    def __call__(self) -> DeviceCryptoUnitOfWork: ...
