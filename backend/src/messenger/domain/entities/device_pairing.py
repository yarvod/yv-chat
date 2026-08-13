"""Durable one-time linking between a trusted and a candidate device."""

import re
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from messenger.domain.entities._validation import (
    normalize_bounded_text,
    require_aware_datetime,
)
from messenger.domain.exceptions import DomainValidationError

PAIRING_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class DevicePairingPurpose(StrEnum):
    ENROLLMENT_REQUEST = "enrollment_request"
    ENROLLMENT_OFFER = "enrollment_offer"


class DevicePairingStatus(StrEnum):
    CREATED = "created"
    CONFIRMATION_PENDING = "confirmation_pending"
    APPROVED = "approved"
    AUTHORIZED = "authorized"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


@dataclass(frozen=True, slots=True)
class DevicePairing:
    """State machine persisted without raw scan, proof, or session credentials."""

    id: UUID
    protocol_version: int
    purpose: DevicePairingPurpose
    status: DevicePairingStatus
    scan_token_hash: str
    candidate_proof_hash: str | None
    candidate_device_name: str | None
    candidate_session_id: UUID | None
    candidate_device_id: UUID | None
    user_id: UUID | None
    trusted_session_id: UUID | None
    trusted_device_id: UUID | None
    authorized_session_id: UUID | None
    authorized_device_id: UUID | None
    created_at: datetime
    expires_at: datetime
    scanned_at: datetime | None
    approved_at: datetime | None
    authorized_at: datetime | None
    cancelled_at: datetime | None
    expired_at: datetime | None
    history_sync_cancelled_at: datetime | None

    def __post_init__(self) -> None:
        if self.protocol_version != 1:
            raise DomainValidationError("unsupported pairing protocol version")
        if PAIRING_HASH_PATTERN.fullmatch(self.scan_token_hash) is None:
            raise DomainValidationError("scan_token_hash must be a lowercase SHA-256 digest")
        if self.candidate_proof_hash is not None and (
            PAIRING_HASH_PATTERN.fullmatch(self.candidate_proof_hash) is None
        ):
            raise DomainValidationError("candidate_proof_hash must be a lowercase SHA-256 digest")
        if self.candidate_device_name is not None:
            normalized_name = normalize_bounded_text(
                self.candidate_device_name,
                field_name="candidate_device_name",
                maximum_length=80,
            )
            if normalized_name != self.candidate_device_name:
                raise DomainValidationError("candidate_device_name must be trimmed")

        created_at = require_aware_datetime(self.created_at, "created_at")
        expires_at = require_aware_datetime(self.expires_at, "expires_at")
        if expires_at <= created_at:
            raise DomainValidationError("expires_at must be after created_at")
        for field_name, value in (
            ("scanned_at", self.scanned_at),
            ("approved_at", self.approved_at),
            ("authorized_at", self.authorized_at),
            ("cancelled_at", self.cancelled_at),
            ("expired_at", self.expired_at),
            ("history_sync_cancelled_at", self.history_sync_cancelled_at),
        ):
            if value is not None and require_aware_datetime(value, field_name) < created_at:
                raise DomainValidationError(f"{field_name} must not be before created_at")

        trusted_values = (self.user_id, self.trusted_session_id, self.trusted_device_id)
        if any(value is None for value in trusted_values) and any(
            value is not None for value in trusted_values
        ):
            raise DomainValidationError("trusted pairing binding must be complete")
        candidate_values = (self.candidate_proof_hash, self.candidate_device_name)
        if (candidate_values[0] is None) != (candidate_values[1] is None):
            raise DomainValidationError("candidate pairing binding must be complete")
        existing_candidate_values = (self.candidate_session_id, self.candidate_device_id)
        if (existing_candidate_values[0] is None) != (existing_candidate_values[1] is None):
            raise DomainValidationError("existing candidate binding must be complete")
        if self.candidate_proof_hash is not None and self.candidate_session_id is not None:
            raise DomainValidationError("candidate binding modes are mutually exclusive")

        if self.purpose is DevicePairingPurpose.ENROLLMENT_REQUEST:
            if self.candidate_proof_hash is None:
                raise DomainValidationError("request pairing requires candidate binding")
        elif self.user_id is None:
            raise DomainValidationError("offer pairing requires trusted binding")

        if self.status in {
            DevicePairingStatus.CONFIRMATION_PENDING,
            DevicePairingStatus.APPROVED,
            DevicePairingStatus.AUTHORIZED,
        } and (
            self.user_id is None
            or (self.candidate_proof_hash is None and self.candidate_session_id is None)
        ):
            raise DomainValidationError("advanced pairing state requires both bindings")
        if (
            self.status
            in {
                DevicePairingStatus.CONFIRMATION_PENDING,
                DevicePairingStatus.APPROVED,
                DevicePairingStatus.AUTHORIZED,
            }
            and self.scanned_at is None
        ):
            raise DomainValidationError("scanned_at is required after scan")
        if (
            self.status in {DevicePairingStatus.APPROVED, DevicePairingStatus.AUTHORIZED}
            and self.approved_at is None
        ):
            raise DomainValidationError("approved_at is required after approval")
        if self.status is DevicePairingStatus.AUTHORIZED:
            if (
                self.authorized_at is None
                or self.authorized_session_id is None
                or self.authorized_device_id is None
            ):
                raise DomainValidationError("authorized pairing requires issued identities")
        else:
            if any(
                value is not None
                for value in (
                    self.authorized_at,
                    self.authorized_session_id,
                    self.authorized_device_id,
                )
            ):
                raise DomainValidationError("issued identities require authorized status")
        if (self.status is DevicePairingStatus.CANCELLED) != (self.cancelled_at is not None):
            raise DomainValidationError("cancelled_at must match cancelled status")
        if (self.status is DevicePairingStatus.EXPIRED) != (self.expired_at is not None):
            raise DomainValidationError("expired_at must match expired status")
        if self.history_sync_cancelled_at is not None and (
            self.status is not DevicePairingStatus.AUTHORIZED
            or self.authorized_at is None
            or self.history_sync_cancelled_at < self.authorized_at
        ):
            raise DomainValidationError("only an authorized history sync may be cancelled")

    @classmethod
    def create_request(
        cls,
        *,
        scan_token_hash: str,
        candidate_proof_hash: str,
        candidate_device_name: str,
        now: datetime,
        expires_at: datetime,
        pairing_id: UUID | None = None,
    ) -> "DevicePairing":
        return cls(
            id=pairing_id or uuid4(),
            protocol_version=1,
            purpose=DevicePairingPurpose.ENROLLMENT_REQUEST,
            status=DevicePairingStatus.CREATED,
            scan_token_hash=scan_token_hash,
            candidate_proof_hash=candidate_proof_hash,
            candidate_device_name=normalize_bounded_text(
                candidate_device_name,
                field_name="candidate_device_name",
                maximum_length=80,
            ),
            candidate_session_id=None,
            candidate_device_id=None,
            user_id=None,
            trusted_session_id=None,
            trusted_device_id=None,
            authorized_session_id=None,
            authorized_device_id=None,
            created_at=now,
            expires_at=expires_at,
            scanned_at=None,
            approved_at=None,
            authorized_at=None,
            cancelled_at=None,
            expired_at=None,
            history_sync_cancelled_at=None,
        )

    @classmethod
    def create_offer(
        cls,
        *,
        scan_token_hash: str,
        user_id: UUID,
        trusted_session_id: UUID,
        trusted_device_id: UUID,
        now: datetime,
        expires_at: datetime,
        pairing_id: UUID | None = None,
    ) -> "DevicePairing":
        return cls(
            id=pairing_id or uuid4(),
            protocol_version=1,
            purpose=DevicePairingPurpose.ENROLLMENT_OFFER,
            status=DevicePairingStatus.CREATED,
            scan_token_hash=scan_token_hash,
            candidate_proof_hash=None,
            candidate_device_name=None,
            candidate_session_id=None,
            candidate_device_id=None,
            user_id=user_id,
            trusted_session_id=trusted_session_id,
            trusted_device_id=trusted_device_id,
            authorized_session_id=None,
            authorized_device_id=None,
            created_at=now,
            expires_at=expires_at,
            scanned_at=None,
            approved_at=None,
            authorized_at=None,
            cancelled_at=None,
            expired_at=None,
            history_sync_cancelled_at=None,
        )

    def is_expired(self, now: datetime) -> bool:
        return require_aware_datetime(now, "now") >= self.expires_at

    def expire(self, now: datetime) -> "DevicePairing":
        timestamp = require_aware_datetime(now, "now")
        if self.status in {
            DevicePairingStatus.AUTHORIZED,
            DevicePairingStatus.CANCELLED,
            DevicePairingStatus.EXPIRED,
        }:
            return self
        if timestamp < self.expires_at:
            return self
        return replace(self, status=DevicePairingStatus.EXPIRED, expired_at=timestamp)

    def scan_request(
        self,
        *,
        user_id: UUID,
        trusted_session_id: UUID,
        trusted_device_id: UUID,
        now: datetime,
    ) -> "DevicePairing":
        if self.purpose is not DevicePairingPurpose.ENROLLMENT_REQUEST:
            raise DomainValidationError("pairing purpose mismatch")
        if self.status is not DevicePairingStatus.CREATED or self.is_expired(now):
            raise DomainValidationError("pairing cannot be scanned")
        return replace(
            self,
            status=DevicePairingStatus.CONFIRMATION_PENDING,
            user_id=user_id,
            trusted_session_id=trusted_session_id,
            trusted_device_id=trusted_device_id,
            scanned_at=now,
        )

    def scan_offer(
        self,
        *,
        candidate_proof_hash: str,
        candidate_device_name: str,
        now: datetime,
    ) -> "DevicePairing":
        if self.purpose is not DevicePairingPurpose.ENROLLMENT_OFFER:
            raise DomainValidationError("pairing purpose mismatch")
        if self.status is not DevicePairingStatus.CREATED or self.is_expired(now):
            raise DomainValidationError("pairing cannot be scanned")
        return replace(
            self,
            status=DevicePairingStatus.CONFIRMATION_PENDING,
            candidate_proof_hash=candidate_proof_hash,
            candidate_device_name=normalize_bounded_text(
                candidate_device_name,
                field_name="candidate_device_name",
                maximum_length=80,
            ),
            scanned_at=now,
        )

    def scan_existing_offer(
        self,
        *,
        candidate_session_id: UUID,
        candidate_device_id: UUID,
        now: datetime,
    ) -> "DevicePairing":
        if self.purpose is not DevicePairingPurpose.ENROLLMENT_OFFER:
            raise DomainValidationError("pairing purpose mismatch")
        if self.status is not DevicePairingStatus.CREATED or self.is_expired(now):
            raise DomainValidationError("pairing cannot be scanned")
        if candidate_device_id == self.trusted_device_id:
            raise DomainValidationError("pairing requires two different devices")
        return replace(
            self,
            status=DevicePairingStatus.CONFIRMATION_PENDING,
            candidate_session_id=candidate_session_id,
            candidate_device_id=candidate_device_id,
            scanned_at=now,
        )

    def approve(self, *, trusted_session_id: UUID, now: datetime) -> "DevicePairing":
        if self.trusted_session_id != trusted_session_id:
            raise DomainValidationError("only the bound trusted session may approve")
        if self.status in {
            DevicePairingStatus.APPROVED,
            DevicePairingStatus.AUTHORIZED,
        }:
            return self
        if self.status is not DevicePairingStatus.CONFIRMATION_PENDING or self.is_expired(now):
            raise DomainValidationError("pairing cannot be approved")
        if self.candidate_session_id is not None and self.candidate_device_id is not None:
            return replace(
                self,
                status=DevicePairingStatus.AUTHORIZED,
                approved_at=now,
                authorized_at=now,
                authorized_session_id=self.candidate_session_id,
                authorized_device_id=self.candidate_device_id,
            )
        return replace(self, status=DevicePairingStatus.APPROVED, approved_at=now)

    def authorize(
        self,
        *,
        device_id: UUID,
        session_id: UUID,
        now: datetime,
    ) -> "DevicePairing":
        if self.status is not DevicePairingStatus.APPROVED or self.is_expired(now):
            raise DomainValidationError("pairing cannot be authorized")
        return replace(
            self,
            status=DevicePairingStatus.AUTHORIZED,
            authorized_device_id=device_id,
            authorized_session_id=session_id,
            authorized_at=now,
        )

    def cancel(self, *, now: datetime) -> "DevicePairing":
        timestamp = require_aware_datetime(now, "now")
        if self.status in {
            DevicePairingStatus.AUTHORIZED,
            DevicePairingStatus.CANCELLED,
            DevicePairingStatus.EXPIRED,
        }:
            return self
        return replace(
            self,
            status=DevicePairingStatus.CANCELLED,
            cancelled_at=timestamp,
        )

    def cancel_history_sync(self, *, now: datetime) -> "DevicePairing":
        timestamp = require_aware_datetime(now, "now")
        if self.status is not DevicePairingStatus.AUTHORIZED:
            raise DomainValidationError("only an authorized pairing has history sync")
        if self.history_sync_cancelled_at is not None:
            return self
        return replace(self, history_sync_cancelled_at=timestamp)
