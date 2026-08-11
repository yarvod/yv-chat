"""Add bounded versioned opaque message envelopes.

Revision ID: 0008_opaque_messages
Revises: 0007_account_security_events
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_opaque_messages"
down_revision: str | None = "0007_account_security_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the opaque ciphertext envelope table without plaintext fields."""
    op.create_table(
        "messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("sender_user_id", sa.Uuid(), nullable=False),
        sa.Column("sender_device_id", sa.Uuid(), nullable=False),
        sa.Column("protocol_version", sa.SmallInteger(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "protocol_version BETWEEN 1 AND 32767",
            name=op.f("ck_messages_protocol_version_range"),
        ),
        sa.CheckConstraint(
            "octet_length(ciphertext) BETWEEN 1 AND 1048576",
            name=op.f("ck_messages_ciphertext_size"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_messages_conversation_id_conversations"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sender_user_id"],
            ["users.id"],
            name=op.f("fk_messages_sender_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sender_device_id"],
            ["devices.id"],
            name=op.f("fk_messages_sender_device_id_devices"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_messages")),
    )
    op.create_index(
        "ix_messages_conversation_created",
        "messages",
        ["conversation_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_messages_sender_device",
        "messages",
        ["sender_device_id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove opaque messages."""
    op.drop_index("ix_messages_sender_device", table_name="messages")
    op.drop_index("ix_messages_conversation_created", table_name="messages")
    op.drop_table("messages")
