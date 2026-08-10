"""Create users and devices.

Revision ID: 0001_users_devices
Revises: None
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_users_devices"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the initial identity tables."""
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "char_length(display_name) BETWEEN 1 AND 80",
            name=op.f("ck_users_display_name_length"),
        ),
        sa.CheckConstraint(
            "updated_at >= created_at",
            name=op.f("ck_users_updated_after_created"),
        ),
        sa.CheckConstraint(
            "char_length(username) BETWEEN 3 AND 32",
            name=op.f("ck_users_username_length"),
        ),
        sa.CheckConstraint(
            "username = lower(username)",
            name=op.f("ck_users_username_normalized"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_index(
        "uq_users_username_lower",
        "users",
        [sa.literal_column("lower(username)")],
        unique=True,
    )

    op.create_table(
        "devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "last_seen_at >= created_at",
            name=op.f("ck_devices_last_seen_after_created"),
        ),
        sa.CheckConstraint(
            "char_length(name) BETWEEN 1 AND 80",
            name=op.f("ck_devices_name_length"),
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name=op.f("ck_devices_revoked_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_devices_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_devices")),
    )
    op.create_index("ix_devices_user_id", "devices", ["user_id"], unique=False)


def downgrade() -> None:
    """Remove the initial identity tables."""
    op.drop_index("ix_devices_user_id", table_name="devices")
    op.drop_table("devices")
    op.drop_index("uq_users_username_lower", table_name="users")
    op.drop_table("users")
