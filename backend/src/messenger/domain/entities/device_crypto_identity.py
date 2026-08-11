"""Immutable public OpenMLS identity registered for one device."""

from dataclasses import dataclass, replace
from datetime import datetime
from hashlib import sha256
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError

PROTOCOL_VERSION = 2
CREDENTIAL_SCHEMA_VERSION = 1
CREDENTIAL_IDENTITY_BYTES = 33
SIGNATURE_PUBLIC_KEY_BYTES = 32
MAX_KEY_PACKAGE_BYTES = 1024 * 1024
MAX_KEY_PACKAGE_BATCH = 16
MAX_KEY_PACKAGE_BATCH_BYTES = 4 * 1024 * 1024
DEVICE_FINGERPRINT_LABEL = b"yv-chat-device-fingerprint-v1\0"


def expected_credential_identity(user_id: UUID, device_id: UUID) -> bytes:
    """Build the canonical identity layout shared with the pinned Rust provider."""
    return bytes([CREDENTIAL_SCHEMA_VERSION]) + user_id.bytes + device_id.bytes


def public_fingerprint(credential_identity: bytes, signature_public_key: bytes) -> str:
    """Derive the public comparison anchor defined by the protocol ADR."""
    return sha256(DEVICE_FINGERPRINT_LABEL + credential_identity + signature_public_key).hexdigest()


@dataclass(frozen=True, slots=True)
class DeviceCryptoIdentity:
    device_id: UUID
    user_id: UUID
    protocol_version: int
    credential_identity: bytes
    signature_public_key: bytes
    fingerprint: str
    created_at: datetime

    def __post_init__(self) -> None:
        require_aware_datetime(self.created_at, "created_at")
        if self.protocol_version != PROTOCOL_VERSION:
            raise DomainValidationError("unsupported device crypto protocol version")
        if self.credential_identity != expected_credential_identity(self.user_id, self.device_id):
            raise DomainValidationError("credential identity does not match device owner")
        if len(self.signature_public_key) != SIGNATURE_PUBLIC_KEY_BYTES:
            raise DomainValidationError("signature public key has invalid length")
        expected_fingerprint = public_fingerprint(
            self.credential_identity, self.signature_public_key
        )
        if self.fingerprint != expected_fingerprint:
            raise DomainValidationError("device fingerprint is invalid")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        device_id: UUID,
        credential_identity: bytes,
        signature_public_key: bytes,
        now: datetime,
    ) -> "DeviceCryptoIdentity":
        identity = bytes(credential_identity)
        signature_key = bytes(signature_public_key)
        return cls(
            device_id=device_id,
            user_id=user_id,
            protocol_version=PROTOCOL_VERSION,
            credential_identity=identity,
            signature_public_key=signature_key,
            fingerprint=public_fingerprint(identity, signature_key),
            created_at=require_aware_datetime(now, "now"),
        )

    def matches(self, other: "DeviceCryptoIdentity") -> bool:
        """Allow only an exact idempotent retry for an immutable identity."""
        return (
            self.device_id == other.device_id
            and self.user_id == other.user_id
            and self.protocol_version == other.protocol_version
            and self.credential_identity == other.credential_identity
            and self.signature_public_key == other.signature_public_key
            and self.fingerprint == other.fingerprint
        )


@dataclass(frozen=True, slots=True)
class DeviceKeyPackage:
    id: UUID
    device_id: UUID
    user_id: UUID
    package_ref: str
    key_package: bytes
    created_at: datetime
    claimed_at: datetime | None = None
    claimed_by_user_id: UUID | None = None
    claimed_by_device_id: UUID | None = None
    claim_conversation_id: UUID | None = None
    claim_request_id: UUID | None = None

    def __post_init__(self) -> None:
        require_aware_datetime(self.created_at, "created_at")
        if not 0 < len(self.key_package) <= MAX_KEY_PACKAGE_BYTES:
            raise DomainValidationError("KeyPackage has invalid length")
        if self.package_ref != sha256(self.key_package).hexdigest():
            raise DomainValidationError("KeyPackage reference is invalid")
        claim_values = (
            self.claimed_at,
            self.claimed_by_user_id,
            self.claimed_by_device_id,
            self.claim_conversation_id,
            self.claim_request_id,
        )
        if any(value is not None for value in claim_values) and not all(
            value is not None for value in claim_values
        ):
            raise DomainValidationError("KeyPackage claim metadata must be complete")
        if self.claimed_at is not None:
            require_aware_datetime(self.claimed_at, "claimed_at")
            if self.claimed_at < self.created_at:
                raise DomainValidationError("claimed_at must not precede created_at")
            if self.claimed_by_device_id == self.device_id:
                raise DomainValidationError("a device cannot claim its own KeyPackage")

    @classmethod
    def create(
        cls,
        *,
        user_id: UUID,
        device_id: UUID,
        key_package: bytes,
        now: datetime,
    ) -> "DeviceKeyPackage":
        package = bytes(key_package)
        return cls(
            id=uuid4(),
            device_id=device_id,
            user_id=user_id,
            package_ref=sha256(package).hexdigest(),
            key_package=package,
            created_at=require_aware_datetime(now, "now"),
        )

    @property
    def is_claimed(self) -> bool:
        return self.claimed_at is not None

    def claim(
        self,
        *,
        claimed_by_user_id: UUID,
        claimed_by_device_id: UUID,
        conversation_id: UUID,
        request_id: UUID,
        now: datetime,
    ) -> "DeviceKeyPackage":
        if self.is_claimed:
            raise DomainValidationError("KeyPackage has already been claimed")
        return replace(
            self,
            claimed_at=require_aware_datetime(now, "now"),
            claimed_by_user_id=claimed_by_user_id,
            claimed_by_device_id=claimed_by_device_id,
            claim_conversation_id=conversation_id,
            claim_request_id=request_id,
        )
