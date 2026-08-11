"""Conversation and membership ORM models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from messenger.infrastructure.persistence.models.base import Base


class ConversationModel(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint(
            "conversation_type IN ('direct', 'group')",
            name="type_allowed",
        ),
        CheckConstraint(
            "(conversation_type = 'direct' AND title IS NULL "
            "AND direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL) OR "
            "(conversation_type = 'group' AND title IS NOT NULL "
            "AND direct_user_low_id IS NULL AND direct_user_high_id IS NULL)",
            name="shape_matches_type",
        ),
        CheckConstraint(
            "direct_user_low_id IS NULL OR direct_user_low_id < direct_user_high_id",
            name="direct_pair_ordered",
        ),
        CheckConstraint(
            "conversation_type <> 'direct' OR "
            "created_by IN (direct_user_low_id, direct_user_high_id)",
            name="direct_creator_in_pair",
        ),
        CheckConstraint(
            "title IS NULL OR char_length(title) BETWEEN 1 AND 100",
            name="title_length",
        ),
        CheckConstraint("updated_at >= created_at", name="updated_after_created"),
        CheckConstraint("last_message_sequence >= 0", name="last_message_sequence_non_negative"),
        Index(
            "uq_conversations_direct_pair",
            "direct_user_low_id",
            "direct_user_high_id",
            unique=True,
        ),
        Index("ix_conversations_created_by", "created_by"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    conversation_type: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    direct_user_low_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    direct_user_high_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_message_sequence: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    members: Mapped[list["ConversationMemberModel"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        lazy="raise",
    )


class ConversationMemberModel(Base):
    __tablename__ = "conversation_members"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'member')", name="role_allowed"),
        CheckConstraint("left_at IS NULL OR left_at >= joined_at", name="left_after_joined"),
        Index("ix_conversation_members_user_active", "user_id", "left_at"),
    )

    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    conversation: Mapped[ConversationModel] = relationship(back_populates="members")
