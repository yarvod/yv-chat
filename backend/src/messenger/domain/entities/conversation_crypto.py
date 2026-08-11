"""Opaque server-side coordination state for one MLS conversation generation."""

from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from messenger.domain.entities._validation import require_aware_datetime
from messenger.domain.exceptions import DomainValidationError

MLS_PROTOCOL_VERSION = 2
MAX_MLS_WIRE_BYTES = 1024 * 1024


class ConversationCryptoStatus(StrEnum):
    PENDING = "pending"
    READY = "ready"
    BLOCKED = "blocked"


class ConversationCryptoBlockReason(StrEnum):
    MISSING_IDENTITY = "missing_identity"
    MISSING_KEY_PACKAGE = "missing_key_package"
    MEMBERSHIP_CHANGED = "membership_changed"
    DEVICE_ROSTER_CHANGED = "device_roster_changed"
    COORDINATOR_REVOKED = "coordinator_revoked"
    PROTOCOL_FAILURE = "protocol_failure"


@dataclass(frozen=True, slots=True)
class ConversationCryptoGeneration:
    id: UUID
    conversation_id: UUID
    generation_number: int
    is_current: bool
    coordinator_user_id: UUID
    coordinator_device_id: UUID
    bootstrap_request_id: UUID
    protocol_version: int
    status: ConversationCryptoStatus
    epoch: int | None
    commit_message: bytes | None
    ratchet_tree: bytes | None
    block_reason: ConversationCryptoBlockReason | None
    created_at: datetime
    updated_at: datetime
    ready_at: datetime | None

    def __post_init__(self) -> None:
        created_at = require_aware_datetime(self.created_at, "created_at")
        updated_at = require_aware_datetime(self.updated_at, "updated_at")
        if updated_at < created_at:
            raise DomainValidationError("generation update cannot precede creation")
        if self.protocol_version != MLS_PROTOCOL_VERSION:
            raise DomainValidationError("unsupported conversation crypto protocol")
        if self.generation_number <= 0:
            raise DomainValidationError("generation number must be positive")
        if (self.commit_message is None) != (self.ratchet_tree is None):
            raise DomainValidationError("commit and ratchet tree must be stored together")
        for name, value in (
            ("commit_message", self.commit_message),
            ("ratchet_tree", self.ratchet_tree),
        ):
            if value is not None and not 0 < len(value) <= MAX_MLS_WIRE_BYTES:
                raise DomainValidationError(f"{name} has invalid length")
        if self.status is ConversationCryptoStatus.PENDING:
            if any(
                value is not None
                for value in (self.epoch, self.commit_message, self.ready_at, self.block_reason)
            ):
                raise DomainValidationError("pending generation has finalized state")
        elif self.status is ConversationCryptoStatus.READY:
            if (
                self.epoch is None
                or self.epoch <= 0
                or self.commit_message is None
                or self.ratchet_tree is None
                or self.ready_at is None
                or self.block_reason is not None
            ):
                raise DomainValidationError("ready generation is incomplete")
            ready_at = require_aware_datetime(self.ready_at, "ready_at")
            if ready_at < created_at or updated_at < ready_at:
                raise DomainValidationError("ready timestamp is inconsistent")
        elif self.status is ConversationCryptoStatus.BLOCKED and self.block_reason is None:
            raise DomainValidationError("blocked generation requires a reason")

    @classmethod
    def create(
        cls,
        *,
        conversation_id: UUID,
        generation_number: int,
        coordinator_user_id: UUID,
        coordinator_device_id: UUID,
        bootstrap_request_id: UUID,
        now: datetime,
        generation_id: UUID | None = None,
    ) -> "ConversationCryptoGeneration":
        timestamp = require_aware_datetime(now, "now")
        return cls(
            id=generation_id or uuid4(),
            conversation_id=conversation_id,
            generation_number=generation_number,
            is_current=True,
            coordinator_user_id=coordinator_user_id,
            coordinator_device_id=coordinator_device_id,
            bootstrap_request_id=bootstrap_request_id,
            protocol_version=MLS_PROTOCOL_VERSION,
            status=ConversationCryptoStatus.PENDING,
            epoch=None,
            commit_message=None,
            ratchet_tree=None,
            block_reason=None,
            created_at=timestamp,
            updated_at=timestamp,
            ready_at=None,
        )

    def finalize(
        self,
        *,
        epoch: int,
        commit_message: bytes,
        ratchet_tree: bytes,
        now: datetime,
    ) -> "ConversationCryptoGeneration":
        if not self.is_current or self.status is not ConversationCryptoStatus.PENDING:
            raise DomainValidationError("only the current pending generation can be finalized")
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.updated_at:
            raise DomainValidationError("generation update cannot move backwards")
        return replace(
            self,
            status=ConversationCryptoStatus.READY,
            epoch=epoch,
            commit_message=bytes(commit_message),
            ratchet_tree=bytes(ratchet_tree),
            updated_at=timestamp,
            ready_at=timestamp,
        )

    def block(
        self,
        reason: ConversationCryptoBlockReason,
        now: datetime,
    ) -> "ConversationCryptoGeneration":
        if not self.is_current:
            return self
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.updated_at:
            raise DomainValidationError("generation update cannot move backwards")
        return replace(
            self,
            status=ConversationCryptoStatus.BLOCKED,
            block_reason=reason,
            updated_at=timestamp,
        )

    def supersede(self, now: datetime) -> "ConversationCryptoGeneration":
        timestamp = require_aware_datetime(now, "now")
        if timestamp < self.updated_at:
            raise DomainValidationError("generation update cannot move backwards")
        return replace(self, is_current=False, updated_at=timestamp)


@dataclass(frozen=True, slots=True)
class ConversationCryptoRequiredDevice:
    generation_id: UUID
    user_id: UUID
    device_id: UUID
    is_coordinator: bool
    key_package_id: UUID | None
    snapshot_at: datetime

    def __post_init__(self) -> None:
        require_aware_datetime(self.snapshot_at, "snapshot_at")
        if self.is_coordinator and self.key_package_id is not None:
            raise DomainValidationError("coordinator cannot claim its own KeyPackage")

    def bind_key_package(self, key_package_id: UUID) -> "ConversationCryptoRequiredDevice":
        if self.is_coordinator:
            raise DomainValidationError("coordinator cannot claim its own KeyPackage")
        if self.key_package_id is not None and self.key_package_id != key_package_id:
            raise DomainValidationError("required device already has another KeyPackage")
        return replace(self, key_package_id=key_package_id)


@dataclass(frozen=True, slots=True)
class ConversationCryptoWelcome:
    generation_id: UUID
    target_device_id: UUID
    welcome_message: bytes
    created_at: datetime
    expires_at: datetime
    acknowledged_at: datetime | None = None

    def __post_init__(self) -> None:
        created_at = require_aware_datetime(self.created_at, "created_at")
        expires_at = require_aware_datetime(self.expires_at, "expires_at")
        if not 0 < len(self.welcome_message) <= MAX_MLS_WIRE_BYTES:
            raise DomainValidationError("Welcome has invalid length")
        if expires_at <= created_at:
            raise DomainValidationError("Welcome expiry must follow creation")
        if self.acknowledged_at is not None:
            acknowledged_at = require_aware_datetime(self.acknowledged_at, "acknowledged_at")
            if acknowledged_at < created_at:
                raise DomainValidationError("Welcome acknowledgement precedes creation")

    def acknowledge(self, now: datetime) -> "ConversationCryptoWelcome":
        timestamp = require_aware_datetime(now, "now")
        if self.acknowledged_at is not None:
            return self
        if timestamp >= self.expires_at:
            raise DomainValidationError("expired Welcome cannot be acknowledged")
        return replace(self, acknowledged_at=timestamp)
