"""Add device-bound Web Push subscriptions.

Revision ID: 0021_push_subscriptions
Revises: 0020_video_attachments
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_push_subscriptions"
down_revision: str | None = "0020_video_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.String(length=2048), nullable=False),
        sa.Column("p256dh", sa.String(length=256), nullable=False),
        sa.Column("auth", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "char_length(auth) BETWEEN 1 AND 128",
            name=op.f("ck_push_subscriptions_auth_length"),
        ),
        sa.CheckConstraint(
            "char_length(endpoint) BETWEEN 1 AND 2048",
            name=op.f("ck_push_subscriptions_endpoint_length"),
        ),
        sa.CheckConstraint(
            "char_length(p256dh) BETWEEN 1 AND 256",
            name=op.f("ck_push_subscriptions_p256dh_length"),
        ),
        sa.CheckConstraint(
            "updated_at >= created_at",
            name=op.f("ck_push_subscriptions_updated_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["devices.id", "devices.user_id"],
            name=op.f("fk_push_subscriptions_device_id_devices"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_push_subscriptions")),
        sa.UniqueConstraint(
            "device_id",
            name="uq_push_subscriptions_device_id",
        ),
        sa.UniqueConstraint(
            "endpoint",
            name="uq_push_subscriptions_endpoint",
        ),
    )
    op.create_index(
        "ix_push_subscriptions_user_id",
        "push_subscriptions",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
