"""Web Push subscription ORM model."""

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


class PushSubscriptionModel(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["devices.id", "devices.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("char_length(endpoint) BETWEEN 1 AND 2048", name="endpoint_length"),
        CheckConstraint("char_length(p256dh) BETWEEN 1 AND 256", name="p256dh_length"),
        CheckConstraint("char_length(auth) BETWEEN 1 AND 128", name="auth_length"),
        CheckConstraint("updated_at >= created_at", name="updated_after_created"),
        UniqueConstraint("device_id", name="uq_push_subscriptions_device_id"),
        UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
        Index("ix_push_subscriptions_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(2048), nullable=False)
    p256dh: Mapped[str] = mapped_column(String(256), nullable=False)
    auth: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
