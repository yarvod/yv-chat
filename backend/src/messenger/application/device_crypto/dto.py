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


@dataclass(frozen=True, slots=True)
class DeviceKeyPackageInventoryResult:
    device_id: UUID
    available_count: int


@dataclass(frozen=True, slots=True)
class ReplenishDeviceKeyPackagesResult:
    device_id: UUID
    added_count: int
    available_count: int


@dataclass(frozen=True, slots=True)
class ClaimedDeviceKeyPackageResult:
    conversation_id: UUID
    claim_request_id: UUID
    target_device_id: UUID
    target_user_id: UUID
    protocol_version: int
    credential_identity: bytes
    signature_public_key: bytes
    fingerprint: str
    package_ref: str
    key_package: bytes
    claimed_at: datetime

    @classmethod
    def from_entities(
        cls,
        identity: DeviceCryptoIdentity,
        key_package: DeviceKeyPackage,
    ) -> "ClaimedDeviceKeyPackageResult":
        if key_package.claim_conversation_id is None:
            raise ValueError("claimed KeyPackage is missing conversation")
        if key_package.claim_request_id is None:
            raise ValueError("claimed KeyPackage is missing request id")
        if key_package.claimed_at is None:
            raise ValueError("claimed KeyPackage is missing timestamp")
        return cls(
            conversation_id=key_package.claim_conversation_id,
            claim_request_id=key_package.claim_request_id,
            target_device_id=identity.device_id,
            target_user_id=identity.user_id,
            protocol_version=identity.protocol_version,
            credential_identity=identity.credential_identity,
            signature_public_key=identity.signature_public_key,
            fingerprint=identity.fingerprint,
            package_ref=key_package.package_ref,
            key_package=key_package.key_package,
            claimed_at=key_package.claimed_at,
        )
