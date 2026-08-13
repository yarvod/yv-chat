"""Opaque MLS history relay model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class DeviceHistoryChunkModel(Base):
    __tablename__ = "device_history_chunks"
    __table_args__ = (
        UniqueConstraint(
            "pairing_id",
            "sender_device_id",
            "client_chunk_id",
            name="uq_device_history_chunks_idempotency",
        ),
        Index(
            "ix_device_history_chunks_target_pending",
            "pairing_id",
            "target_device_id",
            "server_sequence",
        ),
        Index("ix_device_history_chunks_expires_at", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    server_sequence: Mapped[int] = mapped_column(
        BigInteger,
        Identity(always=False),
        nullable=False,
        unique=True,
    )
    pairing_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("device_pairings.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_device_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    target_device_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    client_chunk_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    ciphertext_base64: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
