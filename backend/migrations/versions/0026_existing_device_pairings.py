"""Bind existing authenticated devices through QR pairing.

Revision ID: 0026_existing_device_pairings
Revises: 0025_device_history_chunks
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_existing_device_pairings"
down_revision: str | None = "0025_device_history_chunks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("device_pairings", sa.Column("candidate_session_id", sa.Uuid(), nullable=True))
    op.add_column("device_pairings", sa.Column("candidate_device_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_device_pairings_candidate_session_id_sessions"),
        "device_pairings",
        "sessions",
        ["candidate_session_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_device_pairings_candidate_device_id_devices"),
        "device_pairings",
        "devices",
        ["candidate_device_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        op.f("ck_device_pairings_existing_candidate_binding_complete"),
        "device_pairings",
        "(candidate_session_id IS NULL) = (candidate_device_id IS NULL)",
    )
    op.create_check_constraint(
        op.f("ck_device_pairings_candidate_binding_modes_exclusive"),
        "device_pairings",
        "candidate_proof_hash IS NULL OR candidate_session_id IS NULL",
    )
    op.create_index(
        "ix_device_pairings_candidate_session_id",
        "device_pairings",
        ["candidate_session_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_device_pairings_candidate_session_id", table_name="device_pairings")
    op.drop_constraint(
        op.f("ck_device_pairings_candidate_binding_modes_exclusive"),
        "device_pairings",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_device_pairings_existing_candidate_binding_complete"),
        "device_pairings",
        type_="check",
    )
    op.drop_constraint(
        op.f("fk_device_pairings_candidate_device_id_devices"),
        "device_pairings",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_device_pairings_candidate_session_id_sessions"),
        "device_pairings",
        type_="foreignkey",
    )
    op.drop_column("device_pairings", "candidate_device_id")
    op.drop_column("device_pairings", "candidate_session_id")
