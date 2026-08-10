"""Opaque authentication session ORM model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class SessionModel(Base):
    """Hashed credentials and lifecycle for a device-bound session."""

    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint("char_length(current_token_hash) = 64", name="current_hash_length"),
        CheckConstraint(
            "previous_token_hash IS NULL OR char_length(previous_token_hash) = 64",
            name="previous_hash_length",
        ),
        CheckConstraint(
            "(previous_token_hash IS NULL) = (previous_token_expires_at IS NULL)",
            name="previous_pair",
        ),
        CheckConstraint(
            "previous_token_hash IS NULL OR previous_token_hash <> current_token_hash",
            name="token_hashes_differ",
        ),
        CheckConstraint("last_seen_at >= created_at", name="last_seen_after_created"),
        CheckConstraint("idle_expires_at > last_seen_at", name="idle_after_last_seen"),
        CheckConstraint("absolute_expires_at > created_at", name="absolute_after_created"),
        CheckConstraint(
            "idle_expires_at <= absolute_expires_at",
            name="idle_before_absolute",
        ),
        CheckConstraint("rotated_at >= created_at", name="rotated_after_created"),
        CheckConstraint(
            "previous_token_expires_at IS NULL OR previous_token_expires_at > rotated_at",
            name="previous_expiry_after_rotation",
        ),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="revoked_after_created",
        ),
        ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["devices.id", "devices.user_id"],
            ondelete="CASCADE",
            name="fk_sessions_device_owner_devices",
        ),
        UniqueConstraint("device_id", name="uq_sessions_device"),
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_idle_expires_at", "idle_expires_at"),
        Index("ix_sessions_absolute_expires_at", "absolute_expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    current_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    previous_token_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        unique=True,
    )
    previous_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rotated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
