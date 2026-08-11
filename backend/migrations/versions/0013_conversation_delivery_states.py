"""Add per-device delivery cursors and delivery receipt sync events.

Revision ID: 0013_delivery_states
Revises: 0012_conversation_read_states
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_delivery_states"
down_revision: str | None = "0012_conversation_read_states"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversation_delivery_states",
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("last_delivered_sequence", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "last_delivered_sequence > 0",
            name=op.f("ck_conversation_delivery_states_last_delivered_sequence_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_conversation_delivery_states_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            name=op.f("fk_conversation_delivery_states_device_id_devices"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "device_id",
            "conversation_id",
            name=op.f("pk_conversation_delivery_states"),
        ),
    )
    op.create_index(
        "ix_delivery_states_conversation",
        "conversation_delivery_states",
        ["conversation_id", "last_delivered_sequence"],
    )
    op.add_column("sync_events", sa.Column("delivery_sequence", sa.BigInteger()))
    op.drop_constraint(op.f("ck_sync_events_event_type_allowed"), "sync_events", type_="check")
    op.drop_constraint(op.f("ck_sync_events_shape_matches_type"), "sync_events", type_="check")
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


def downgrade() -> None:
    op.execute("DELETE FROM sync_events WHERE event_type = 'delivery_receipt'")
    op.drop_constraint(op.f("ck_sync_events_shape_matches_type"), "sync_events", type_="check")
    op.drop_constraint(op.f("ck_sync_events_event_type_allowed"), "sync_events", type_="check")
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
    op.drop_column("sync_events", "delivery_sequence")
    op.drop_index("ix_delivery_states_conversation", table_name="conversation_delivery_states")
    op.drop_table("conversation_delivery_states")
