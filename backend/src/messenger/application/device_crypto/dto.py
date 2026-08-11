"""Application DTOs for public device cryptography anchors."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.domain.entities import DeviceCryptoIdentity, DeviceKeyPackage


@dataclass(frozen=True, slots=True)
class DeviceCryptoIdentityResult:
    device_id: UUID
    user_id: UUID
    protocol_version: int
    credential_identity: bytes
    signature_public_key: bytes
    fingerprint: str
    initial_key_package_ref: str
    created_at: datetime

    @classmethod
    def from_entities(
        cls,
        identity: DeviceCryptoIdentity,
        key_package: DeviceKeyPackage,
    ) -> "DeviceCryptoIdentityResult":
        return cls(
            device_id=identity.device_id,
            user_id=identity.user_id,
            protocol_version=identity.protocol_version,
            credential_identity=identity.credential_identity,
            signature_public_key=identity.signature_public_key,
            fingerprint=identity.fingerprint,
            initial_key_package_ref=key_package.package_ref,
            created_at=identity.created_at,
        )
