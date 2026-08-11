"""Add message TTL, tombstones and a non-reusable sequence high-water mark.

Revision ID: 0014_message_tombstones
Revises: 0013_delivery_states
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_message_tombstones"
down_revision: str | None = "0013_delivery_states"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "last_message_sequence",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
    )
    op.execute(
        "UPDATE conversations AS conversation "
        "SET last_message_sequence = COALESCE(("
        "SELECT MAX(message.sequence) FROM messages AS message "
        "WHERE message.conversation_id = conversation.id), 0)"
    )
    op.create_check_constraint(
        op.f("ck_conversations_last_message_sequence_non_negative"),
        "conversations",
        "last_message_sequence >= 0",
    )

    op.add_column("messages", sa.Column("expires_at", sa.DateTime(timezone=True)))
    op.add_column("messages", sa.Column("ciphertext_digest", sa.String(length=64)))
    op.add_column("messages", sa.Column("deletion_reason", sa.String(length=16)))
    op.add_column("messages", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("messages", sa.Column("deleted_by_user_id", sa.Uuid()))
    op.add_column("messages", sa.Column("tombstone_expires_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE messages SET expires_at = created_at + INTERVAL '30 days'")
    op.execute("UPDATE messages SET ciphertext_digest = encode(sha256(ciphertext), 'hex')")
    op.alter_column("messages", "expires_at", nullable=False)
    op.alter_column("messages", "ciphertext_digest", nullable=False)
    op.create_check_constraint(
        op.f("ck_messages_ciphertext_digest_format"),
        "messages",
        "ciphertext_digest ~ '^[0-9a-f]{64}$'",
    )
    op.alter_column("messages", "ciphertext", existing_type=sa.LargeBinary(), nullable=True)
    op.create_foreign_key(
        op.f("fk_messages_deleted_by_user_id_users"),
        "messages",
        "users",
        ["deleted_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.drop_constraint(op.f("ck_messages_ciphertext_size"), "messages", type_="check")
    op.create_check_constraint(
        op.f("ck_messages_ciphertext_size"),
        "messages",
        "ciphertext IS NULL OR octet_length(ciphertext) BETWEEN 1 AND 1048576",
    )
    op.create_check_constraint(
        op.f("ck_messages_expires_after_created"),
        "messages",
        "expires_at > created_at",
    )
    op.create_check_constraint(
        op.f("ck_messages_tombstone_shape"),
        "messages",
        "(ciphertext IS NOT NULL AND deletion_reason IS NULL AND deleted_at IS NULL "
        "AND deleted_by_user_id IS NULL AND tombstone_expires_at IS NULL) OR "
        "(ciphertext IS NULL AND deletion_reason IN ('manual', 'expired') "
        "AND deleted_at IS NOT NULL AND tombstone_expires_at > deleted_at "
        "AND ((deletion_reason = 'manual' AND deleted_by_user_id IS NOT NULL) "
        "OR (deletion_reason = 'expired' AND deleted_by_user_id IS NULL)))",
    )
    op.create_index(
        "ix_messages_expiry_active",
        "messages",
        ["expires_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_messages_tombstone_expiry",
        "messages",
        ["tombstone_expires_at"],
        postgresql_where=sa.text("deleted_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DELETE FROM messages WHERE ciphertext IS NULL")
    op.drop_index("ix_messages_tombstone_expiry", table_name="messages")
    op.drop_index("ix_messages_expiry_active", table_name="messages")
    op.drop_constraint(op.f("ck_messages_tombstone_shape"), "messages", type_="check")
    op.drop_constraint(op.f("ck_messages_expires_after_created"), "messages", type_="check")
    op.drop_constraint(op.f("ck_messages_ciphertext_size"), "messages", type_="check")
    op.drop_constraint(op.f("ck_messages_ciphertext_digest_format"), "messages", type_="check")
    op.create_check_constraint(
        op.f("ck_messages_ciphertext_size"),
        "messages",
        "octet_length(ciphertext) BETWEEN 1 AND 1048576",
    )
    op.drop_constraint(op.f("fk_messages_deleted_by_user_id_users"), "messages", type_="foreignkey")
    op.alter_column("messages", "ciphertext", existing_type=sa.LargeBinary(), nullable=False)
    op.drop_column("messages", "tombstone_expires_at")
    op.drop_column("messages", "deleted_by_user_id")
    op.drop_column("messages", "deleted_at")
    op.drop_column("messages", "deletion_reason")
    op.drop_column("messages", "expires_at")
    op.drop_column("messages", "ciphertext_digest")
    op.drop_constraint(
        op.f("ck_conversations_last_message_sequence_non_negative"),
        "conversations",
        type_="check",
    )
    op.drop_column("conversations", "last_message_sequence")
