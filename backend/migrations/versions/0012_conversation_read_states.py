"""Add shared conversation read cursors and read receipt sync events.

Revision ID: 0012_conversation_read_states
Revises: 0011_password_reset_tokens
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_conversation_read_states"
down_revision: str | None = "0011_password_reset_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversation_read_states",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("last_read_sequence", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "last_read_sequence > 0",
            name=op.f("ck_conversation_read_states_last_read_sequence_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_conversation_read_states_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_conversation_read_states_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id",
            "conversation_id",
            name=op.f("pk_conversation_read_states"),
        ),
    )
    op.create_index(
        "ix_read_states_conversation",
        "conversation_read_states",
        ["conversation_id", "last_read_sequence"],
    )
    op.add_column("sync_events", sa.Column("actor_user_id", sa.Uuid(), nullable=True))
    op.add_column("sync_events", sa.Column("read_sequence", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        op.f("fk_sync_events_actor_user_id_users"),
        "sync_events",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint(op.f("ck_sync_events_event_type_allowed"), "sync_events", type_="check")
    op.drop_constraint(op.f("ck_sync_events_shape_matches_type"), "sync_events", type_="check")
    op.create_check_constraint(
        op.f("ck_sync_events_event_type_allowed"),
        "sync_events",
        "event_type IN ('conversation_updated', 'message_created', 'message_deleted', "
        "'read_receipt')",
    )
    op.create_check_constraint(
        op.f("ck_sync_events_shape_matches_type"),
        "sync_events",
        "(event_type = 'conversation_updated' AND message_id IS NULL "
        "AND actor_user_id IS NULL AND read_sequence IS NULL) OR "
        "(event_type IN ('message_created', 'message_deleted') AND message_id IS NOT NULL "
        "AND actor_user_id IS NULL AND read_sequence IS NULL) OR "
        "(event_type = 'read_receipt' AND message_id IS NULL AND actor_user_id IS NOT NULL "
        "AND read_sequence > 0)",
    )


def downgrade() -> None:
    op.execute("DELETE FROM sync_events WHERE event_type = 'read_receipt'")
    op.drop_constraint(op.f("ck_sync_events_shape_matches_type"), "sync_events", type_="check")
    op.drop_constraint(op.f("ck_sync_events_event_type_allowed"), "sync_events", type_="check")
    op.create_check_constraint(
        op.f("ck_sync_events_event_type_allowed"),
        "sync_events",
        "event_type IN ('conversation_updated', 'message_created', 'message_deleted')",
    )
    op.create_check_constraint(
        op.f("ck_sync_events_shape_matches_type"),
        "sync_events",
        "(event_type = 'conversation_updated' AND message_id IS NULL) OR "
        "(event_type IN ('message_created', 'message_deleted') AND message_id IS NOT NULL)",
    )
    op.drop_constraint(
        op.f("fk_sync_events_actor_user_id_users"), "sync_events", type_="foreignkey"
    )
    op.drop_column("sync_events", "read_sequence")
    op.drop_column("sync_events", "actor_user_id")
    op.drop_index("ix_read_states_conversation", table_name="conversation_read_states")
    op.drop_table("conversation_read_states")
