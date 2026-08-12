"""Add opaque group attachment storage metadata.

Revision ID: 0019_group_attachments
Revises: 0018_message_crypto_binding
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_group_attachments"
down_revision: str | None = "0018_message_crypto_binding"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("client_attachment_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("uploader_user_id", sa.Uuid(), nullable=False),
        sa.Column("uploader_device_id", sa.Uuid(), nullable=False),
        sa.Column("storage_key", sa.String(length=100), nullable=False),
        sa.Column("media_kind", sa.String(length=16), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256_digest", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("committed_message_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "sha256_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_attachments_sha256_digest_format"),
        ),
        sa.CheckConstraint(
            "byte_size > 0",
            name=op.f("ck_attachments_byte_size_positive"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_attachments_expires_after_created"),
        ),
        sa.CheckConstraint(
            "media_kind IN ('image', 'file')",
            name=op.f("ck_attachments_media_kind_allowed"),
        ),
        sa.ForeignKeyConstraint(
            ["committed_message_id"],
            ["messages.id"],
            name=op.f("fk_attachments_committed_message_id_messages"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_attachments_conversation_id_conversations"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["uploader_device_id", "uploader_user_id"],
            ["devices.id", "devices.user_id"],
            name=op.f("fk_attachments_uploader_device_id_uploader_user_id_devices"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_attachments")),
        sa.UniqueConstraint(
            "storage_key",
            name=op.f("uq_attachments_storage_key"),
        ),
        sa.UniqueConstraint(
            "uploader_device_id",
            "client_attachment_id",
            name=op.f("uq_attachments_device_client_id"),
        ),
    )
    op.create_index(
        op.f("ix_attachments_committed_message"),
        "attachments",
        ["committed_message_id"],
    )
    op.create_index(
        op.f("ix_attachments_conversation"),
        "attachments",
        ["conversation_id", "created_at"],
    )
    op.create_index(
        op.f("ix_attachments_expiry"),
        "attachments",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_attachments_expiry"), table_name="attachments")
    op.drop_index(op.f("ix_attachments_conversation"), table_name="attachments")
    op.drop_index(op.f("ix_attachments_committed_message"), table_name="attachments")
    op.drop_table("attachments")
