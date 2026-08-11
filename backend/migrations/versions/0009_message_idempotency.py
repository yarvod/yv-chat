"""Add device-scoped idempotency and conversation sequence.

Revision ID: 0009_message_idempotency
Revises: 0008_opaque_messages
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_message_idempotency"
down_revision: str | None = "0008_opaque_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Backfill existing envelopes then enforce stable retry/order keys."""
    op.add_column("messages", sa.Column("client_message_id", sa.Uuid(), nullable=True))
    op.add_column("messages", sa.Column("sequence", sa.BigInteger(), nullable=True))
    op.execute("UPDATE messages SET client_message_id = id")
    op.execute(
        "WITH numbered AS ("
        " SELECT id, row_number() OVER (PARTITION BY conversation_id "
        " ORDER BY created_at, id) AS value FROM messages"
        ") UPDATE messages SET sequence = numbered.value "
        "FROM numbered WHERE messages.id = numbered.id"
    )
    op.alter_column("messages", "client_message_id", nullable=False)
    op.alter_column("messages", "sequence", nullable=False)
    op.create_check_constraint(
        op.f("ck_messages_sequence_positive"),
        "messages",
        "sequence > 0",
    )
    op.create_index(
        "uq_messages_sender_device_client_id",
        "messages",
        ["sender_device_id", "client_message_id"],
        unique=True,
    )
    op.create_index(
        "uq_messages_conversation_sequence",
        "messages",
        ["conversation_id", "sequence"],
        unique=True,
    )


def downgrade() -> None:
    """Remove retry and sequence columns."""
    op.drop_index("uq_messages_conversation_sequence", table_name="messages")
    op.drop_index("uq_messages_sender_device_client_id", table_name="messages")
    op.drop_constraint(
        op.f("ck_messages_sequence_positive"),
        "messages",
        type_="check",
    )
    op.drop_column("messages", "sequence")
    op.drop_column("messages", "client_message_id")
