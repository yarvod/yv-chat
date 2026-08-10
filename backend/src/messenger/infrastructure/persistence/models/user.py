"""User ORM model."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class UserModel(Base):
    """Database representation of a user account."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("char_length(username) BETWEEN 3 AND 32", name="username_length"),
        CheckConstraint("username = lower(username)", name="username_normalized"),
        CheckConstraint("char_length(display_name) BETWEEN 1 AND 80", name="display_name_length"),
        CheckConstraint("updated_at >= created_at", name="updated_after_created"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


Index("uq_users_username_lower", func.lower(UserModel.username), unique=True)
