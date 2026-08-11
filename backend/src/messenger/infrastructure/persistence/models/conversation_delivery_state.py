"""Per-device conversation delivery cursor ORM model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class ConversationDeliveryStateModel(Base):
    __tablename__ = "conversation_delivery_states"
    __table_args__ = (
        CheckConstraint("last_delivered_sequence > 0", name="last_delivered_sequence_positive"),
        Index("ix_delivery_states_conversation", "conversation_id", "last_delivered_sequence"),
    )

    device_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True
    )
    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    last_delivered_sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
