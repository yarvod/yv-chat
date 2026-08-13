"""Add standalone managed registration invitations.

Revision ID: 0023_registration_invitations
Revises: 0022_message_reactions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_registration_invitations"
down_revision: str | None = "0022_message_reactions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "registration_invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("registered_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "char_length(token_hash) = 64",
            name=op.f("ck_registration_invitations_token_hash_length"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_registration_invitations_expires_after_created"),
        ),
        sa.CheckConstraint(
            "used_at IS NULL OR used_at >= created_at",
            name=op.f("ck_registration_invitations_used_after_created"),
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name=op.f("ck_registration_invitations_revoked_after_created"),
        ),
        sa.CheckConstraint(
            "NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL)",
            name=op.f("ck_registration_invitations_not_used_and_revoked"),
        ),
        sa.CheckConstraint(
            "(used_at IS NULL) = (registered_user_id IS NULL)",
            name=op.f("ck_registration_invitations_used_has_registered_user"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_registration_invitations_created_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["registered_user_id"],
            ["users.id"],
            name=op.f("fk_registration_invitations_registered_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_registration_invitations")),
        sa.UniqueConstraint(
            "token_hash",
            name=op.f("uq_registration_invitations_token_hash"),
        ),
    )
    op.create_index(
        "ix_registration_invitations_created_at",
        "registration_invitations",
        ["created_at"],
    )
    op.create_index(
        "ix_registration_invitations_expires_at",
        "registration_invitations",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_registration_invitations_expires_at",
        table_name="registration_invitations",
    )
    op.drop_index(
        "ix_registration_invitations_created_at",
        table_name="registration_invitations",
    )
    op.drop_table("registration_invitations")
