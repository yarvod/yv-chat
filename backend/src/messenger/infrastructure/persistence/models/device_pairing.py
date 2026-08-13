"""Durable QR device-pairing model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, and_, func
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class DevicePairingModel(Base):
    __tablename__ = "device_pairings"
    __table_args__ = (
        CheckConstraint("protocol_version = 1", name="protocol_version_supported"),
        CheckConstraint(
            "purpose IN ('enrollment_request', 'enrollment_offer')",
            name="purpose_supported",
        ),
        CheckConstraint(
            "status IN ('created', 'confirmation_pending', 'approved', "
            "'authorized', 'cancelled', 'expired')",
            name="status_supported",
        ),
        CheckConstraint("char_length(scan_token_hash) = 64", name="scan_hash_length"),
        CheckConstraint(
            "candidate_proof_hash IS NULL OR char_length(candidate_proof_hash) = 64",
            name="proof_hash_length",
        ),
        CheckConstraint(
            "candidate_device_name IS NULL OR char_length(candidate_device_name) BETWEEN 1 AND 80",
            name="candidate_name_length",
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        CheckConstraint(
            "(user_id IS NULL) = (trusted_session_id IS NULL) AND "
            "(user_id IS NULL) = (trusted_device_id IS NULL)",
            name="trusted_binding_complete",
        ),
        CheckConstraint(
            "(candidate_proof_hash IS NULL) = (candidate_device_name IS NULL)",
            name="candidate_binding_complete",
        ),
        CheckConstraint(
            "(candidate_session_id IS NULL) = (candidate_device_id IS NULL)",
            name="existing_candidate_binding_complete",
        ),
        CheckConstraint(
            "candidate_proof_hash IS NULL OR candidate_session_id IS NULL",
            name="candidate_binding_modes_exclusive",
        ),
        CheckConstraint(
            "(status = 'authorized') = (authorized_at IS NOT NULL) AND "
            "(status = 'authorized') = (authorized_session_id IS NOT NULL) AND "
            "(status = 'authorized') = (authorized_device_id IS NOT NULL)",
            name="authorized_binding_complete",
        ),
        CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name="cancelled_binding_complete",
        ),
        CheckConstraint(
            "(status = 'expired') = (expired_at IS NOT NULL)",
            name="expired_binding_complete",
        ),
        CheckConstraint(
            "history_sync_cancelled_at IS NULL OR "
            "(status = 'authorized' AND authorized_at IS NOT NULL "
            "AND history_sync_cancelled_at >= authorized_at)",
            name="history_sync_cancelled_only_after_authorization",
        ),
        Index("ix_device_pairings_expires_at", "expires_at"),
        Index("ix_device_pairings_trusted_session_id", "trusted_session_id"),
        Index("ix_device_pairings_candidate_session_id", "candidate_session_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    protocol_version: Mapped[int]
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    scan_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    candidate_proof_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    candidate_device_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    candidate_session_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sessions.id", ondelete="RESTRICT"), nullable=True
    )
    candidate_device_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="RESTRICT"), nullable=True
    )
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    trusted_session_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True
    )
    trusted_device_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=True
    )
    authorized_session_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sessions.id", ondelete="RESTRICT"), nullable=True
    )
    authorized_device_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    history_sync_cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


Index(
    "uq_device_pairings_active_history_pair",
    DevicePairingModel.user_id,
    func.least(DevicePairingModel.trusted_device_id, DevicePairingModel.authorized_device_id),
    func.greatest(DevicePairingModel.trusted_device_id, DevicePairingModel.authorized_device_id),
    unique=True,
    postgresql_where=and_(
        DevicePairingModel.status == "authorized",
        DevicePairingModel.history_sync_cancelled_at.is_(None),
    ),
)
