"""Allow bounded video attachment metadata.

Revision ID: 0020_video_attachments
Revises: 0019_group_attachments
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0020_video_attachments"
down_revision: str | None = "0019_group_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_attachments_media_kind_allowed"),
        "attachments",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_attachments_media_kind_allowed"),
        "attachments",
        "media_kind IN ('image', 'video', 'file')",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_attachments_media_kind_allowed"),
        "attachments",
        type_="check",
    )
    op.execute("UPDATE attachments SET media_kind = 'file' WHERE media_kind = 'video'")
    op.create_check_constraint(
        op.f("ck_attachments_media_kind_allowed"),
        "attachments",
        "media_kind IN ('image', 'file')",
    )
