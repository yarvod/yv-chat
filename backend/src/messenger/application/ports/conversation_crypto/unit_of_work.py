"""Atomic transaction boundary for conversation MLS coordination."""

from types import TracebackType
from typing import Protocol, Self

from messenger.application.ports.conversation_crypto.repositories import (
    ConversationCryptoGenerationRepository,
    ConversationCryptoRequiredDeviceRepository,
    ConversationCryptoWelcomeRepository,
)
from messenger.application.ports.conversations import ConversationRepository
from messenger.application.ports.device_crypto import (
    DeviceCryptoIdentityRepository,
    DeviceKeyPackageRepository,
)
from messenger.application.ports.identity import DeviceRepository


class ConversationCryptoUnitOfWork(Protocol):
    conversations: ConversationRepository
    devices: DeviceRepository
    identities: DeviceCryptoIdentityRepository
    key_packages: DeviceKeyPackageRepository
    generations: ConversationCryptoGenerationRepository
    required_devices: ConversationCryptoRequiredDeviceRepository
    welcomes: ConversationCryptoWelcomeRepository

    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None: ...


class ConversationCryptoUnitOfWorkFactory(Protocol):
    def __call__(self) -> ConversationCryptoUnitOfWork: ...
