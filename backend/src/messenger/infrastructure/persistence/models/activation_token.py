"""Activation token ORM model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class ActivationTokenModel(Base):
    """Persistent hash and lifecycle for a one-time activation secret."""

    __tablename__ = "activation_tokens"
    __table_args__ = (
        CheckConstraint("char_length(token_hash) = 64", name="token_hash_length"),
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        CheckConstraint(
            "used_at IS NULL OR used_at >= created_at",
            name="used_after_created",
        ),
        Index("ix_activation_tokens_user_id", "user_id"),
        Index("ix_activation_tokens_expires_at", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
