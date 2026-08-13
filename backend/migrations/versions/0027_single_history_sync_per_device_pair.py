"""Keep one cancellable history sync per unordered device pair.

Revision ID: 0027_single_history_sync
Revises: 0026_existing_device_pairings
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_single_history_sync"
down_revision: str | None = "0026_existing_device_pairings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "device_pairings",
        sa.Column("history_sync_cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_device_pairings_history_sync_cancelled_only_after_authorization"),
        "device_pairings",
        "history_sync_cancelled_at IS NULL OR "
        "(status = 'authorized' AND authorized_at IS NOT NULL "
        "AND history_sync_cancelled_at >= authorized_at)",
    )
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT
                    id,
                    row_number() OVER (
                        PARTITION BY
                            user_id,
                            LEAST(trusted_device_id, authorized_device_id),
                            GREATEST(trusted_device_id, authorized_device_id)
                        ORDER BY authorized_at DESC, id DESC
                    ) AS position
                FROM device_pairings
                WHERE status = 'authorized'
            )
            UPDATE device_pairings AS pairing
            SET history_sync_cancelled_at = pairing.authorized_at
            FROM ranked
            WHERE pairing.id = ranked.id AND ranked.position > 1
            """
        )
    )
    op.create_index(
        "uq_device_pairings_active_history_pair",
        "device_pairings",
        [
            "user_id",
            sa.text("LEAST(trusted_device_id, authorized_device_id)"),
            sa.text("GREATEST(trusted_device_id, authorized_device_id)"),
        ],
        unique=True,
        postgresql_where=sa.text("status = 'authorized' AND history_sync_cancelled_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_device_pairings_active_history_pair", table_name="device_pairings")
    op.drop_constraint(
        op.f("ck_device_pairings_history_sync_cancelled_only_after_authorization"),
        "device_pairings",
        type_="check",
    )
    op.drop_column("device_pairings", "history_sync_cancelled_at")
