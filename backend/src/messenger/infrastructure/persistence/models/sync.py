"""Per-user durable cursor stream ORM models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class SyncStreamModel(Base):
    __tablename__ = "sync_streams"
    __table_args__ = (CheckConstraint("last_cursor >= 0", name="cursor_non_negative"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    last_cursor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class SyncEventModel(Base):
    __tablename__ = "sync_events"
    __table_args__ = (
        CheckConstraint("cursor > 0", name="cursor_positive"),
        CheckConstraint(
            "event_type IN ('conversation_updated', 'message_created', 'message_deleted', "
            "'read_receipt', 'delivery_receipt')",
            name="event_type_allowed",
        ),
        CheckConstraint(
            "(event_type = 'conversation_updated' AND message_id IS NULL "
            "AND actor_user_id IS NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
            "(event_type IN ('message_created', 'message_deleted') AND message_id IS NOT NULL "
            "AND actor_user_id IS NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
            "(event_type = 'read_receipt' AND message_id IS NULL AND actor_user_id IS NOT NULL "
            "AND read_sequence > 0 AND delivery_sequence IS NULL) OR "
            "(event_type = 'delivery_receipt' AND message_id IS NULL "
            "AND actor_user_id IS NOT NULL AND read_sequence IS NULL "
            "AND delivery_sequence > 0)",
            name="shape_matches_type",
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        Index("uq_sync_events_event_id", "event_id", unique=True),
        Index("ix_sync_events_expires_at", "expires_at"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    cursor: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    message_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    actor_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    read_sequence: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    delivery_sequence: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
