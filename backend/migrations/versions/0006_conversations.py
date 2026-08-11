"""Add direct/group conversations and membership lifecycle.

Revision ID: 0006_conversations
Revises: 0005_activation_token_revocation
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_conversations"
down_revision: str | None = "0005_activation_token_revocation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create conversation aggregate tables and concurrency constraints."""
    op.create_table(
        "conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_type", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("direct_user_low_id", sa.Uuid(), nullable=True),
        sa.Column("direct_user_high_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "conversation_type IN ('direct', 'group')",
            name=op.f("ck_conversations_type_allowed"),
        ),
        sa.CheckConstraint(
            "(conversation_type = 'direct' AND title IS NULL "
            "AND direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL) OR "
            "(conversation_type = 'group' AND title IS NOT NULL "
            "AND direct_user_low_id IS NULL AND direct_user_high_id IS NULL)",
            name=op.f("ck_conversations_shape_matches_type"),
        ),
        sa.CheckConstraint(
            "direct_user_low_id IS NULL OR direct_user_low_id < direct_user_high_id",
            name=op.f("ck_conversations_direct_pair_ordered"),
        ),
        sa.CheckConstraint(
            "conversation_type <> 'direct' OR "
            "created_by IN (direct_user_low_id, direct_user_high_id)",
            name=op.f("ck_conversations_direct_creator_in_pair"),
        ),
        sa.CheckConstraint(
            "title IS NULL OR char_length(title) BETWEEN 1 AND 100",
            name=op.f("ck_conversations_title_length"),
        ),
        sa.CheckConstraint(
            "updated_at >= created_at",
            name=op.f("ck_conversations_updated_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_conversations_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["direct_user_low_id"],
            ["users.id"],
            name=op.f("fk_conversations_direct_user_low_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["direct_user_high_id"],
            ["users.id"],
            name=op.f("fk_conversations_direct_user_high_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversations")),
    )
    op.create_index(
        "ix_conversations_created_by",
        "conversations",
        ["created_by"],
        unique=False,
    )
    op.create_index(
        "uq_conversations_direct_pair",
        "conversations",
        ["direct_user_low_id", "direct_user_high_id"],
        unique=True,
    )
    op.create_table(
        "conversation_members",
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'member')",
            name=op.f("ck_conversation_members_role_allowed"),
        ),
        sa.CheckConstraint(
            "left_at IS NULL OR left_at >= joined_at",
            name=op.f("ck_conversation_members_left_after_joined"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_conversation_members_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_conversation_members_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "conversation_id",
            "user_id",
            name=op.f("pk_conversation_members"),
        ),
    )
    op.create_index(
        "ix_conversation_members_user_active",
        "conversation_members",
        ["user_id", "left_at"],
        unique=False,
    )


def downgrade() -> None:
    """Remove conversation aggregate tables."""
    op.drop_index(
        "ix_conversation_members_user_active",
        table_name="conversation_members",
    )
    op.drop_table("conversation_members")
    op.drop_index("uq_conversations_direct_pair", table_name="conversations")
    op.drop_index("ix_conversations_created_by", table_name="conversations")
    op.drop_table("conversations")
