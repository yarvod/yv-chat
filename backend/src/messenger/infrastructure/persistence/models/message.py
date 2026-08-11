"""Opaque message ORM model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class MessageModel(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(
            "protocol_version BETWEEN 1 AND 32767",
            name="protocol_version_range",
        ),
        CheckConstraint(
            "ciphertext IS NULL OR octet_length(ciphertext) BETWEEN 1 AND 1048576",
            name="ciphertext_size",
        ),
        CheckConstraint("sequence > 0", name="sequence_positive"),
        CheckConstraint("ciphertext_digest ~ '^[0-9a-f]{64}$'", name="ciphertext_digest_format"),
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        CheckConstraint(
            "(ciphertext IS NOT NULL AND deletion_reason IS NULL AND deleted_at IS NULL "
            "AND deleted_by_user_id IS NULL AND tombstone_expires_at IS NULL) OR "
            "(ciphertext IS NULL AND deletion_reason IN ('manual', 'expired') "
            "AND deleted_at IS NOT NULL AND tombstone_expires_at > deleted_at "
            "AND ((deletion_reason = 'manual' AND deleted_by_user_id IS NOT NULL) "
            "OR (deletion_reason = 'expired' AND deleted_by_user_id IS NULL)))",
            name="tombstone_shape",
        ),
        Index(
            "ix_messages_conversation_created",
            "conversation_id",
            "created_at",
            "id",
        ),
        Index("ix_messages_sender_device", "sender_device_id"),
        Index(
            "ix_messages_expiry_active",
            "expires_at",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_messages_tombstone_expiry",
            "tombstone_expires_at",
            postgresql_where=text("deleted_at IS NOT NULL"),
        ),
        Index(
            "uq_messages_sender_device_client_id",
            "sender_device_id",
            "client_message_id",
            unique=True,
        ),
        Index(
            "uq_messages_conversation_sequence",
            "conversation_id",
            "sequence",
            unique=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    client_message_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    sender_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    sender_device_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=False,
    )
    protocol_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    ciphertext_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deletion_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    tombstone_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
