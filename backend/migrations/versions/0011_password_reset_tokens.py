"""Add purpose-bound password-reset credentials.

Revision ID: 0011_password_reset_tokens
Revises: 0010_sync_events
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_password_reset_tokens"
down_revision: str | None = "0010_sync_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_security_events_event_type_allowed"),
        "security_events",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_security_events_event_type_allowed"),
        "security_events",
        "event_type IN ('login', 'logout', 'credential_replay', "
        "'device_renamed', 'device_revoked', 'other_sessions_revoked', "
        "'password_changed', 'password_reset_issued', "
        "'password_reset_completed', 'security_reset')",
    )
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "char_length(token_hash) = 64",
            name=op.f("ck_password_reset_tokens_token_hash_length"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_password_reset_tokens_expires_after_created"),
        ),
        sa.CheckConstraint(
            "used_at IS NULL OR used_at >= created_at",
            name=op.f("ck_password_reset_tokens_used_after_created"),
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name=op.f("ck_password_reset_tokens_revoked_after_created"),
        ),
        sa.CheckConstraint(
            "NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL)",
            name=op.f("ck_password_reset_tokens_not_used_and_revoked"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_password_reset_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_password_reset_tokens")),
        sa.UniqueConstraint(
            "token_hash",
            name=op.f("uq_password_reset_tokens_token_hash"),
        ),
    )
    op.create_index(
        "ix_password_reset_tokens_user_id",
        "password_reset_tokens",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_password_reset_tokens_expires_at",
        "password_reset_tokens",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_password_reset_tokens_expires_at", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    op.execute(
        "DELETE FROM security_events WHERE event_type IN "
        "('password_reset_issued', 'password_reset_completed')"
    )
    op.drop_constraint(
        op.f("ck_security_events_event_type_allowed"),
        "security_events",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_security_events_event_type_allowed"),
        "security_events",
        "event_type IN ('login', 'logout', 'credential_replay', "
        "'device_renamed', 'device_revoked', 'other_sessions_revoked', "
        "'password_changed', 'security_reset')",
    )
