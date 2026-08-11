"""Add durable per-user cursor streams.

Revision ID: 0010_sync_events
Revises: 0009_message_idempotency
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_sync_events"
down_revision: str | None = "0009_message_idempotency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sync_streams",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_cursor", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "last_cursor >= 0",
            name=op.f("ck_sync_streams_cursor_non_negative"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_sync_streams_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_sync_streams")),
    )
    op.create_table(
        "sync_events",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("cursor", sa.BigInteger(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("cursor > 0", name=op.f("ck_sync_events_cursor_positive")),
        sa.CheckConstraint(
            "event_type IN ('conversation_updated', 'message_created', 'message_deleted')",
            name=op.f("ck_sync_events_event_type_allowed"),
        ),
        sa.CheckConstraint(
            "(event_type = 'conversation_updated' AND message_id IS NULL) OR "
            "(event_type IN ('message_created', 'message_deleted') AND message_id IS NOT NULL)",
            name=op.f("ck_sync_events_shape_matches_type"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_sync_events_expires_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_sync_events_conversation_id_conversations"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_sync_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "cursor", name=op.f("pk_sync_events")),
    )
    op.create_index("uq_sync_events_event_id", "sync_events", ["event_id"], unique=True)
    op.create_index(
        "ix_sync_events_expires_at",
        "sync_events",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_sync_events_expires_at", table_name="sync_events")
    op.drop_index("uq_sync_events_event_id", table_name="sync_events")
    op.drop_table("sync_events")
    op.drop_table("sync_streams")
