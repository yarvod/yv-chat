"""Add device-bound opaque sessions.

Revision ID: 0003_opaque_sessions
Revises: 0002_account_activation
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_opaque_sessions"
down_revision: str | None = "0002_account_activation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add IP metadata and hashed server-side session state."""
    op.add_column("devices", sa.Column("login_ip", sa.String(length=45), nullable=True))
    op.add_column("devices", sa.Column("last_ip", sa.String(length=45), nullable=True))
    op.create_unique_constraint(
        op.f("uq_devices_identity_owner"),
        "devices",
        ["id", "user_id"],
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("current_token_hash", sa.String(length=64), nullable=False),
        sa.Column("previous_token_hash", sa.String(length=64), nullable=True),
        sa.Column("previous_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "absolute_expires_at > created_at",
            name=op.f("ck_sessions_absolute_after_created"),
        ),
        sa.CheckConstraint(
            "char_length(current_token_hash) = 64",
            name=op.f("ck_sessions_current_hash_length"),
        ),
        sa.CheckConstraint(
            "idle_expires_at > last_seen_at",
            name=op.f("ck_sessions_idle_after_last_seen"),
        ),
        sa.CheckConstraint(
            "idle_expires_at <= absolute_expires_at",
            name=op.f("ck_sessions_idle_before_absolute"),
        ),
        sa.CheckConstraint(
            "last_seen_at >= created_at",
            name=op.f("ck_sessions_last_seen_after_created"),
        ),
        sa.CheckConstraint(
            "previous_token_expires_at IS NULL OR previous_token_expires_at > rotated_at",
            name=op.f("ck_sessions_previous_expiry_after_rotation"),
        ),
        sa.CheckConstraint(
            "previous_token_hash IS NULL OR char_length(previous_token_hash) = 64",
            name=op.f("ck_sessions_previous_hash_length"),
        ),
        sa.CheckConstraint(
            "(previous_token_hash IS NULL) = (previous_token_expires_at IS NULL)",
            name=op.f("ck_sessions_previous_pair"),
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name=op.f("ck_sessions_revoked_after_created"),
        ),
        sa.CheckConstraint(
            "rotated_at >= created_at",
            name=op.f("ck_sessions_rotated_after_created"),
        ),
        sa.CheckConstraint(
            "previous_token_hash IS NULL OR previous_token_hash <> current_token_hash",
            name=op.f("ck_sessions_token_hashes_differ"),
        ),
        sa.ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["devices.id", "devices.user_id"],
            name=op.f("fk_sessions_device_owner_devices"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
        sa.UniqueConstraint(
            "current_token_hash",
            name=op.f("uq_sessions_current_token_hash"),
        ),
        sa.UniqueConstraint("device_id", name=op.f("uq_sessions_device")),
        sa.UniqueConstraint(
            "previous_token_hash",
            name=op.f("uq_sessions_previous_token_hash"),
        ),
    )
    op.create_index(
        "ix_sessions_absolute_expires_at",
        "sessions",
        ["absolute_expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_sessions_idle_expires_at",
        "sessions",
        ["idle_expires_at"],
        unique=False,
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], unique=False)


def downgrade() -> None:
    """Remove opaque session state and device IP metadata."""
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_index("ix_sessions_idle_expires_at", table_name="sessions")
    op.drop_index("ix_sessions_absolute_expires_at", table_name="sessions")
    op.drop_table("sessions")
    op.drop_constraint(op.f("uq_devices_identity_owner"), "devices", type_="unique")
    op.drop_column("devices", "last_ip")
    op.drop_column("devices", "login_ip")
