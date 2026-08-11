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
    Uuid,
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
            "octet_length(ciphertext) BETWEEN 1 AND 1048576",
            name="ciphertext_size",
        ),
        CheckConstraint("sequence > 0", name="sequence_positive"),
        Index(
            "ix_messages_conversation_created",
            "conversation_id",
            "created_at",
            "id",
        ),
        Index("ix_messages_sender_device", "sender_device_id"),
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
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
