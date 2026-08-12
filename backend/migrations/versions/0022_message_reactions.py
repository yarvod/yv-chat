"""Add authorized durable message reactions.

Revision ID: 0022_message_reactions
Revises: 0021_push_subscriptions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_message_reactions"
down_revision: str | None = "0021_push_subscriptions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_reactions",
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("reaction", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "char_length(reaction) BETWEEN 1 AND 8",
            name=op.f("ck_message_reactions_reaction_length"),
        ),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            name=op.f("fk_message_reactions_message_id_messages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_message_reactions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "message_id",
            "user_id",
            "reaction",
            name=op.f("pk_message_reactions"),
        ),
    )
    op.create_index(
        "ix_message_reactions_message",
        "message_reactions",
        ["message_id"],
    )
    op.drop_constraint(op.f("ck_sync_events_shape_matches_type"), "sync_events", type_="check")
    op.drop_constraint(op.f("ck_sync_events_event_type_allowed"), "sync_events", type_="check")
    op.create_check_constraint(
        op.f("ck_sync_events_event_type_allowed"),
        "sync_events",
        "event_type IN ('conversation_updated', 'message_created', 'message_deleted', "
        "'message_reaction_updated', 'read_receipt', 'delivery_receipt')",
    )
    op.create_check_constraint(
        op.f("ck_sync_events_shape_matches_type"),
        "sync_events",
        "(event_type = 'conversation_updated' AND message_id IS NULL "
        "AND actor_user_id IS NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
        "(event_type IN ('message_created', 'message_deleted') AND message_id IS NOT NULL "
        "AND actor_user_id IS NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
        "(event_type = 'message_reaction_updated' AND message_id IS NOT NULL "
        "AND actor_user_id IS NOT NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
        "(event_type = 'read_receipt' AND message_id IS NULL AND actor_user_id IS NOT NULL "
        "AND read_sequence > 0 AND delivery_sequence IS NULL) OR "
        "(event_type = 'delivery_receipt' AND message_id IS NULL "
        "AND actor_user_id IS NOT NULL AND read_sequence IS NULL AND delivery_sequence > 0)",
    )


def downgrade() -> None:
    op.execute("DELETE FROM sync_events WHERE event_type = 'message_reaction_updated'")
    op.drop_constraint(op.f("ck_sync_events_shape_matches_type"), "sync_events", type_="check")
    op.drop_constraint(op.f("ck_sync_events_event_type_allowed"), "sync_events", type_="check")
    op.create_check_constraint(
        op.f("ck_sync_events_event_type_allowed"),
        "sync_events",
        "event_type IN ('conversation_updated', 'message_created', 'message_deleted', "
        "'read_receipt', 'delivery_receipt')",
    )
    op.create_check_constraint(
        op.f("ck_sync_events_shape_matches_type"),
        "sync_events",
        "(event_type = 'conversation_updated' AND message_id IS NULL "
        "AND actor_user_id IS NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
        "(event_type IN ('message_created', 'message_deleted') AND message_id IS NOT NULL "
        "AND actor_user_id IS NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
        "(event_type = 'read_receipt' AND message_id IS NULL AND actor_user_id IS NOT NULL "
        "AND read_sequence > 0 AND delivery_sequence IS NULL) OR "
        "(event_type = 'delivery_receipt' AND message_id IS NULL "
        "AND actor_user_id IS NOT NULL AND read_sequence IS NULL AND delivery_sequence > 0)",
    )
    op.drop_index("ix_message_reactions_message", table_name="message_reactions")
    op.drop_table("message_reactions")
