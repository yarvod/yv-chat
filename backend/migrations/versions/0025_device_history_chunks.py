"""Add opaque device history relay chunks.

Revision ID: 0025_device_history_chunks
Revises: 0024_device_pairings
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_device_history_chunks"
down_revision: str | None = "0024_device_pairings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_history_chunks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "server_sequence",
            sa.BigInteger(),
            sa.Identity(always=False),
            nullable=False,
        ),
        sa.Column("pairing_id", sa.Uuid(), nullable=False),
        sa.Column("sender_device_id", sa.Uuid(), nullable=False),
        sa.Column("target_device_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("client_chunk_id", sa.Uuid(), nullable=False),
        sa.Column("ciphertext_base64", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["pairing_id"],
            ["device_pairings.id"],
            ondelete="CASCADE",
            name=op.f("fk_device_history_chunks_pairing_id_device_pairings"),
        ),
        sa.ForeignKeyConstraint(
            ["sender_device_id"],
            ["devices.id"],
            ondelete="CASCADE",
            name=op.f("fk_device_history_chunks_sender_device_id_devices"),
        ),
        sa.ForeignKeyConstraint(
            ["target_device_id"],
            ["devices.id"],
            ondelete="CASCADE",
            name=op.f("fk_device_history_chunks_target_device_id_devices"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            ondelete="CASCADE",
            name=op.f("fk_device_history_chunks_conversation_id_conversations"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_history_chunks")),
        sa.UniqueConstraint(
            "server_sequence",
            name=op.f("uq_device_history_chunks_server_sequence"),
        ),
        sa.UniqueConstraint(
            "pairing_id",
            "sender_device_id",
            "client_chunk_id",
            name="uq_device_history_chunks_idempotency",
        ),
    )
    op.create_index(
        "ix_device_history_chunks_target_pending",
        "device_history_chunks",
        ["pairing_id", "target_device_id", "server_sequence"],
    )
    op.create_index(
        "ix_device_history_chunks_expires_at",
        "device_history_chunks",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_device_history_chunks_expires_at", table_name="device_history_chunks")
    op.drop_index("ix_device_history_chunks_target_pending", table_name="device_history_chunks")
    op.drop_table("device_history_chunks")
