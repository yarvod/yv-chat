"""Opaque MLS generation, required-device snapshot and Welcome queue models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class ConversationCryptoGenerationModel(Base):
    __tablename__ = "conversation_crypto_generations"
    __table_args__ = (
        CheckConstraint("generation_number > 0", name="generation_number_positive"),
        CheckConstraint("protocol_version = 2", name="protocol_version_supported"),
        CheckConstraint("status IN ('pending', 'ready', 'blocked')", name="status_allowed"),
        CheckConstraint(
            "block_reason IS NULL OR block_reason IN "
            "('missing_identity', 'missing_key_package', 'membership_changed', "
            "'device_roster_changed', 'coordinator_revoked', 'protocol_failure')",
            name="block_reason_allowed",
        ),
        CheckConstraint("epoch IS NULL OR epoch > 0", name="epoch_positive"),
        CheckConstraint("updated_at >= created_at", name="updated_after_created"),
        CheckConstraint(
            "ready_at IS NULL OR (ready_at >= created_at AND updated_at >= ready_at)",
            name="ready_time_consistent",
        ),
        CheckConstraint(
            "(commit_message IS NULL) = (ratchet_tree IS NULL)",
            name="opaque_payload_complete",
        ),
        CheckConstraint(
            "commit_message IS NULL OR octet_length(commit_message) BETWEEN 1 AND 1048576",
            name="commit_message_length",
        ),
        CheckConstraint(
            "ratchet_tree IS NULL OR octet_length(ratchet_tree) BETWEEN 1 AND 1048576",
            name="ratchet_tree_length",
        ),
        CheckConstraint(
            "(status = 'pending' AND epoch IS NULL AND commit_message IS NULL "
            "AND ready_at IS NULL AND block_reason IS NULL) OR "
            "(status = 'ready' AND epoch > 0 AND commit_message IS NOT NULL "
            "AND ready_at IS NOT NULL AND block_reason IS NULL) OR "
            "(status = 'blocked' AND block_reason IS NOT NULL AND "
            "((epoch IS NULL AND commit_message IS NULL AND ready_at IS NULL) OR "
            "(epoch > 0 AND commit_message IS NOT NULL AND ready_at IS NOT NULL)))",
            name="shape_matches_status",
        ),
        ForeignKeyConstraint(
            ["coordinator_device_id", "coordinator_user_id"],
            ["devices.id", "devices.user_id"],
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "conversation_id",
            "generation_number",
            name="uq_conversation_crypto_generation_number",
        ),
        UniqueConstraint(
            "coordinator_device_id",
            "bootstrap_request_id",
            name="uq_conversation_crypto_bootstrap_request",
        ),
        Index(
            "uq_conversation_crypto_current",
            "conversation_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
        Index("ix_conversation_crypto_status", "status", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    generation_number: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False)
    coordinator_user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    coordinator_device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    bootstrap_request_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    protocol_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    epoch: Mapped[int | None] = mapped_column(BigInteger)
    commit_message: Mapped[bytes | None] = mapped_column(LargeBinary)
    ratchet_tree: Mapped[bytes | None] = mapped_column(LargeBinary)
    block_reason: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ConversationCryptoRequiredDeviceModel(Base):
    __tablename__ = "conversation_crypto_required_devices"
    __table_args__ = (
        CheckConstraint(
            "NOT is_coordinator OR key_package_id IS NULL",
            name="coordinator_has_no_key_package",
        ),
        ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["devices.id", "devices.user_id"],
            ondelete="RESTRICT",
        ),
        UniqueConstraint("key_package_id", name="uq_conversation_crypto_required_package"),
        Index("ix_conversation_crypto_required_user", "user_id", "generation_id"),
    )

    generation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversation_crypto_generations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    is_coordinator: Mapped[bool] = mapped_column(Boolean, nullable=False)
    key_package_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("device_key_packages.id", ondelete="RESTRICT"),
    )
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ConversationCryptoWelcomeModel(Base):
    __tablename__ = "conversation_crypto_welcomes"
    __table_args__ = (
        CheckConstraint(
            "octet_length(welcome_message) BETWEEN 1 AND 1048576",
            name="welcome_message_length",
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        CheckConstraint(
            "acknowledged_at IS NULL OR "
            "(acknowledged_at >= created_at AND acknowledged_at < expires_at)",
            name="acknowledgement_time_valid",
        ),
        ForeignKeyConstraint(
            ["generation_id", "target_device_id"],
            [
                "conversation_crypto_required_devices.generation_id",
                "conversation_crypto_required_devices.device_id",
            ],
            ondelete="CASCADE",
        ),
        Index(
            "ix_conversation_crypto_welcomes_pending",
            "target_device_id",
            "expires_at",
            postgresql_where=text("acknowledged_at IS NULL"),
        ),
    )

    generation_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    target_device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    welcome_message: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
