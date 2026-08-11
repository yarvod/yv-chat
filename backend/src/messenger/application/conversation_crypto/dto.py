"""Application DTOs for opaque MLS conversation coordination."""

from dataclasses import dataclass
from uuid import UUID

from messenger.domain.entities import (
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    ConversationCryptoWelcome,
    DeviceCryptoIdentity,
    DeviceKeyPackage,
)


@dataclass(frozen=True, slots=True)
class RequiredDeviceCryptoResult:
    user_id: UUID
    device_id: UUID
    is_coordinator: bool
    fingerprint: str | None
    credential_identity: bytes | None
    signature_public_key: bytes | None
    key_package_ref: str | None
    key_package: bytes | None

    @classmethod
    def from_entities(
        cls,
        required: ConversationCryptoRequiredDevice,
        identity: DeviceCryptoIdentity | None,
        key_package: DeviceKeyPackage | None,
    ) -> "RequiredDeviceCryptoResult":
        return cls(
            user_id=required.user_id,
            device_id=required.device_id,
            is_coordinator=required.is_coordinator,
            fingerprint=identity.fingerprint if identity else None,
            credential_identity=identity.credential_identity if identity else None,
            signature_public_key=identity.signature_public_key if identity else None,
            key_package_ref=key_package.package_ref if key_package else None,
            key_package=key_package.key_package if key_package else None,
        )


@dataclass(frozen=True, slots=True)
class ConversationCryptoResult:
    generation: ConversationCryptoGeneration
    required_devices: tuple[RequiredDeviceCryptoResult, ...]
    welcome: ConversationCryptoWelcome | None = None
