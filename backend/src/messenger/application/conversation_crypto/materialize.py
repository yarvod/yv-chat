"""Assemble MLS application DTOs without exposing persistence models."""

from messenger.application.conversation_crypto.dto import (
    ConversationCryptoResult,
    RequiredDeviceCryptoResult,
)
from messenger.application.ports.conversation_crypto import ConversationCryptoUnitOfWork
from messenger.domain.entities import ConversationCryptoGeneration, ConversationCryptoWelcome


async def materialize_generation(
    uow: ConversationCryptoUnitOfWork,
    generation: ConversationCryptoGeneration,
    *,
    welcome: ConversationCryptoWelcome | None = None,
) -> ConversationCryptoResult:
    required = await uow.required_devices.list_by_generation(generation.id)
    identities = {
        item.device_id: item
        for item in await uow.identities.get_by_device_ids({item.device_id for item in required})
    }
    packages = {
        item.id: item
        for item in await uow.key_packages.get_by_ids(
            {item.key_package_id for item in required if item.key_package_id is not None}
        )
    }
    return ConversationCryptoResult(
        generation=generation,
        required_devices=tuple(
            RequiredDeviceCryptoResult.from_entities(
                item,
                identities.get(item.device_id),
                packages.get(item.key_package_id) if item.key_package_id is not None else None,
            )
            for item in required
        ),
        welcome=welcome,
    )
