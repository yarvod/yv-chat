"""Opaque group attachment storage metadata ORM model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class AttachmentModel(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint("media_kind IN ('image', 'video', 'file')", name="media_kind_allowed"),
        CheckConstraint("byte_size > 0", name="byte_size_positive"),
        CheckConstraint(
            "sha256_digest ~ '^[0-9a-f]{64}$'",
            name="sha256_digest_format",
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        ForeignKeyConstraint(
            ["uploader_device_id", "uploader_user_id"],
            ["devices.id", "devices.user_id"],
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "uploader_device_id",
            "client_attachment_id",
            name="uq_attachments_device_client_id",
        ),
        UniqueConstraint("storage_key", name="uq_attachments_storage_key"),
        Index("ix_attachments_conversation", "conversation_id", "created_at"),
        Index("ix_attachments_committed_message", "committed_message_id"),
        Index("ix_attachments_expiry", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    client_attachment_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    uploader_user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    uploader_device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(100), nullable=False)
    media_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    committed_message_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
    )
