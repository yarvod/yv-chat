"""Repository ports for opaque MLS generation coordination records."""

from typing import Protocol
from uuid import UUID

from messenger.domain.entities import (
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    ConversationCryptoWelcome,
)


class ConversationCryptoGenerationRepository(Protocol):
    async def get_current(
        self,
        conversation_id: UUID,
        *,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None: ...

    async def get_by_id(
        self,
        generation_id: UUID,
        *,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None: ...

    async def get_latest_ready(
        self,
        conversation_id: UUID,
    ) -> ConversationCryptoGeneration | None: ...

    async def list_ready_for_device_after(
        self,
        *,
        conversation_id: UUID,
        device_id: UUID,
        after_generation_number: int,
        limit: int,
    ) -> list[ConversationCryptoGeneration]: ...

    async def get_by_bootstrap_request(
        self,
        *,
        coordinator_device_id: UUID,
        bootstrap_request_id: UUID,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None: ...

    async def latest_generation_number(self, conversation_id: UUID) -> int: ...

    async def add(self, generation: ConversationCryptoGeneration) -> None: ...

    async def update(self, generation: ConversationCryptoGeneration) -> None: ...


class ConversationCryptoRequiredDeviceRepository(Protocol):
    async def list_by_generation(
        self,
        generation_id: UUID,
    ) -> list[ConversationCryptoRequiredDevice]: ...

    async def add_many(
        self,
        required_devices: tuple[ConversationCryptoRequiredDevice, ...],
    ) -> None: ...


class ConversationCryptoWelcomeRepository(Protocol):
    async def get_for_device(
        self,
        *,
        generation_id: UUID,
        device_id: UUID,
        for_update: bool = False,
    ) -> ConversationCryptoWelcome | None: ...

    async def add_many(self, welcomes: tuple[ConversationCryptoWelcome, ...]) -> None: ...

    async def update(self, welcome: ConversationCryptoWelcome) -> None: ...
