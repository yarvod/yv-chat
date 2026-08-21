"""Browser and native push subscription ORM model."""

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
        CheckConstraint(
            "endpoint IS NULL OR char_length(endpoint) BETWEEN 1 AND 2048",
            name="endpoint_length",
        ),
        CheckConstraint(
            "p256dh IS NULL OR char_length(p256dh) BETWEEN 1 AND 256",
            name="p256dh_length",
        ),
        CheckConstraint("auth IS NULL OR char_length(auth) BETWEEN 1 AND 128", name="auth_length"),
        CheckConstraint(
            "native_token IS NULL OR char_length(native_token) BETWEEN 1 AND 4096",
            name="native_token_length",
        ),
        CheckConstraint("provider IN ('web', 'apns', 'fcm')", name="provider_value"),
        CheckConstraint(
            "(provider = 'web' AND endpoint IS NOT NULL AND p256dh IS NOT NULL "
            "AND auth IS NOT NULL AND native_token IS NULL) OR "
            "(provider IN ('apns', 'fcm') AND endpoint IS NULL AND p256dh IS NULL "
            "AND auth IS NULL AND native_token IS NOT NULL)",
            name="provider_material",
        ),
        CheckConstraint("updated_at >= created_at", name="updated_after_created"),
        UniqueConstraint("device_id", name="uq_push_subscriptions_device_id"),
        UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
        UniqueConstraint("native_token", name="uq_push_subscriptions_native_token"),
        Index("ix_push_subscriptions_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    provider: Mapped[str] = mapped_column(String(8), nullable=False)
    endpoint: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    p256dh: Mapped[str | None] = mapped_column(String(256), nullable=True)
    auth: Mapped[str | None] = mapped_column(String(128), nullable=True)
    native_token: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
