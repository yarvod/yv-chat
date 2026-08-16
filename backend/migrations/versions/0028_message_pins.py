"""Add bounded durable message pins.

Revision ID: 0028_message_pins
Revises: 0027_single_history_sync
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_message_pins"
down_revision: str | None = "0027_single_history_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_pins",
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("pinned_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            name=op.f("fk_message_pins_message_id_messages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_message_pins_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["pinned_by_user_id"],
            ["users.id"],
            name=op.f("fk_message_pins_pinned_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("message_id", name=op.f("pk_message_pins")),
    )
    op.create_index(
        "ix_message_pins_conversation_order",
        "message_pins",
        ["conversation_id", "pinned_at"],
    )

    op.drop_constraint(op.f("ck_sync_events_shape_matches_type"), "sync_events", type_="check")
    op.drop_constraint(op.f("ck_sync_events_event_type_allowed"), "sync_events", type_="check")
    op.create_check_constraint(
        op.f("ck_sync_events_event_type_allowed"),
        "sync_events",
        "event_type IN ('conversation_updated', 'message_created', 'message_deleted', "
        "'message_reaction_updated', 'message_pin_updated', 'read_receipt', "
        "'delivery_receipt')",
    )
    op.create_check_constraint(
        op.f("ck_sync_events_shape_matches_type"),
        "sync_events",
        "(event_type = 'conversation_updated' AND message_id IS NULL "
        "AND actor_user_id IS NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
        "(event_type IN ('message_created', 'message_deleted') AND message_id IS NOT NULL "
        "AND actor_user_id IS NULL AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
        "(event_type IN ('message_reaction_updated', 'message_pin_updated') "
        "AND message_id IS NOT NULL AND actor_user_id IS NOT NULL "
        "AND read_sequence IS NULL AND delivery_sequence IS NULL) OR "
        "(event_type = 'read_receipt' AND message_id IS NULL AND actor_user_id IS NOT NULL "
        "AND read_sequence > 0 AND delivery_sequence IS NULL) OR "
        "(event_type = 'delivery_receipt' AND message_id IS NULL "
        "AND actor_user_id IS NOT NULL AND read_sequence IS NULL AND delivery_sequence > 0)",
    )


def downgrade() -> None:
    op.execute("DELETE FROM sync_events WHERE event_type = 'message_pin_updated'")
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
    op.drop_index("ix_message_pins_conversation_order", table_name="message_pins")
    op.drop_table("message_pins")
