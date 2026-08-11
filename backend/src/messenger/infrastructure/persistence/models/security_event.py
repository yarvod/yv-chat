"""Account security-event ORM model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class SecurityEventModel(Base):
    """Bounded typed event with no arbitrary payload or credentials."""

    __tablename__ = "security_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('login', 'logout', 'credential_replay', "
            "'device_renamed', 'device_revoked', 'other_sessions_revoked', "
            "'password_changed', 'password_reset_issued', "
            "'password_reset_completed', 'security_reset')",
            name="event_type_allowed",
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        Index("ix_security_events_user_created_at", "user_id", "created_at"),
        Index("ix_security_events_expires_at", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_session_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_device_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
    )
