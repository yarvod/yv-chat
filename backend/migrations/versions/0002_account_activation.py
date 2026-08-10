"""Add password hash and account activation tokens.

Revision ID: 0002_account_activation
Revises: 0001_users_devices
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_account_activation"
down_revision: str | None = "0001_users_devices"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add password hashes and one-time activation credential state."""
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))

    op.create_table(
        "activation_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_activation_tokens_expires_after_created"),
        ),
        sa.CheckConstraint(
            "char_length(token_hash) = 64",
            name=op.f("ck_activation_tokens_token_hash_length"),
        ),
        sa.CheckConstraint(
            "used_at IS NULL OR used_at >= created_at",
            name=op.f("ck_activation_tokens_used_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_activation_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activation_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_activation_tokens_token_hash")),
    )
    op.create_index(
        "ix_activation_tokens_expires_at",
        "activation_tokens",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_activation_tokens_user_id",
        "activation_tokens",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove activation state."""
    op.drop_index("ix_activation_tokens_user_id", table_name="activation_tokens")
    op.drop_index("ix_activation_tokens_expires_at", table_name="activation_tokens")
    op.drop_table("activation_tokens")
    op.drop_column("users", "password_hash")
