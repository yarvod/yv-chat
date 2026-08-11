"""Add atomic one-time device KeyPackage claims.

Revision ID: 0016_key_package_claims
Revises: 0015_device_crypto_registry
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_key_package_claims"
down_revision: str | None = "0015_device_crypto_registry"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(
        "ix_device_key_packages_device_created",
        table_name="device_key_packages",
    )
    op.add_column(
        "device_key_packages",
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "device_key_packages",
        sa.Column("claimed_by_user_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "device_key_packages",
        sa.Column("claimed_by_device_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "device_key_packages",
        sa.Column("claim_conversation_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "device_key_packages",
        sa.Column("claim_request_id", sa.Uuid(), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_device_key_packages_claim_metadata_complete"),
        "device_key_packages",
        "(claimed_at IS NULL AND claimed_by_user_id IS NULL "
        "AND claimed_by_device_id IS NULL AND claim_conversation_id IS NULL "
        "AND claim_request_id IS NULL) OR "
        "(claimed_at IS NOT NULL AND claimed_by_user_id IS NOT NULL "
        "AND claimed_by_device_id IS NOT NULL AND claim_conversation_id IS NOT NULL "
        "AND claim_request_id IS NOT NULL)",
    )
    op.create_check_constraint(
        op.f("ck_device_key_packages_claiming_device_differs"),
        "device_key_packages",
        "claimed_by_device_id IS NULL OR claimed_by_device_id <> device_id",
    )
    op.create_check_constraint(
        op.f("ck_device_key_packages_claimed_after_created"),
        "device_key_packages",
        "claimed_at IS NULL OR claimed_at >= created_at",
    )
    op.create_foreign_key(
        op.f("fk_device_key_packages_claimed_by_device_id_devices"),
        "device_key_packages",
        "devices",
        ["claimed_by_device_id", "claimed_by_user_id"],
        ["id", "user_id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_device_key_packages_claim_conversation_id_conversations"),
        "device_key_packages",
        "conversations",
        ["claim_conversation_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_device_key_package_claim_request",
        "device_key_packages",
        ["claimed_by_device_id", "claim_request_id"],
    )
    op.create_index(
        "ix_device_key_packages_available",
        "device_key_packages",
        ["device_id", "created_at", "id"],
        postgresql_where=sa.text("claimed_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_device_key_packages_available", table_name="device_key_packages")
    op.drop_constraint(
        "uq_device_key_package_claim_request",
        "device_key_packages",
        type_="unique",
    )
    op.drop_constraint(
        op.f("fk_device_key_packages_claim_conversation_id_conversations"),
        "device_key_packages",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_device_key_packages_claimed_by_device_id_devices"),
        "device_key_packages",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("ck_device_key_packages_claimed_after_created"),
        "device_key_packages",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_device_key_packages_claiming_device_differs"),
        "device_key_packages",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_device_key_packages_claim_metadata_complete"),
        "device_key_packages",
        type_="check",
    )
    for column in (
        "claim_request_id",
        "claim_conversation_id",
        "claimed_by_device_id",
        "claimed_by_user_id",
        "claimed_at",
    ):
        op.drop_column("device_key_packages", column)
    op.create_index(
        "ix_device_key_packages_device_created",
        "device_key_packages",
        ["device_id", "created_at"],
    )
