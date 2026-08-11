"""Bind MLS messages to an exact ready generation and epoch.

Revision ID: 0018_message_crypto_binding
Revises: 0017_conversation_crypto
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_message_crypto_binding"
down_revision: str | None = "0017_conversation_crypto"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("crypto_generation_id", sa.Uuid(), nullable=True))
    op.add_column("messages", sa.Column("crypto_epoch", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        op.f("fk_messages_crypto_generation_id_conversation_crypto_generations"),
        "messages",
        "conversation_crypto_generations",
        ["crypto_generation_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        op.f("ck_messages_crypto_binding_shape"),
        "messages",
        "(protocol_version = 2 AND crypto_generation_id IS NOT NULL AND crypto_epoch > 0) "
        "OR (protocol_version <> 2 AND crypto_generation_id IS NULL AND crypto_epoch IS NULL)",
    )
    op.create_index(
        op.f("ix_messages_crypto_generation_id"),
        "messages",
        ["crypto_generation_id"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_messages_crypto_generation_id"), table_name="messages")
    op.drop_constraint(
        op.f("ck_messages_crypto_binding_shape"),
        "messages",
        type_="check",
    )
    op.drop_constraint(
        op.f("fk_messages_crypto_generation_id_conversation_crypto_generations"),
        "messages",
        type_="foreignkey",
    )
    op.drop_column("messages", "crypto_epoch")
    op.drop_column("messages", "crypto_generation_id")
