"""Add bounded account security events.

Revision ID: 0004_security_events
Revises: 0003_opaque_sessions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_security_events"
down_revision: str | None = "0003_opaque_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create a typed event table without arbitrary secret-bearing payload."""
    op.create_table(
        "security_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_session_id", sa.Uuid(), nullable=True),
        sa.Column("target_device_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "event_type IN ('login', 'logout', 'credential_replay', "
            "'device_renamed', 'device_revoked', 'other_sessions_revoked')",
            name=op.f("ck_security_events_event_type_allowed"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_security_events_expires_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_session_id"],
            ["sessions.id"],
            name=op.f("fk_security_events_actor_session_id_sessions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["target_device_id"],
            ["devices.id"],
            name=op.f("fk_security_events_target_device_id_devices"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_security_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_security_events")),
    )
    op.create_index(
        "ix_security_events_expires_at",
        "security_events",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_security_events_user_created_at",
        "security_events",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    """Remove account security events."""
    op.drop_index("ix_security_events_user_created_at", table_name="security_events")
    op.drop_index("ix_security_events_expires_at", table_name="security_events")
    op.drop_table("security_events")
