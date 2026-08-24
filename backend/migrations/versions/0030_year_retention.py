"""Extend active messages and committed media to one-year retention.

Revision ID: 0030_year_retention
Revises: 0029_native_push
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0030_year_retention"
down_revision: str | None = "0029_native_push"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE messages "
        "SET expires_at = created_at + INTERVAL '365 days' "
        "WHERE deleted_at IS NULL "
        "AND expires_at < created_at + INTERVAL '365 days'"
    )
    op.execute(
        "UPDATE attachments AS attachment "
        "SET expires_at = message.expires_at "
        "FROM messages AS message "
        "WHERE attachment.committed_message_id = message.id "
        "AND message.deleted_at IS NULL "
        "AND attachment.expires_at < message.expires_at"
    )


def downgrade() -> None:
    # Extension-only data cannot be shortened safely during a code rollback.
    pass
