"""Add durable QR device pairings.

Revision ID: 0024_device_pairings
Revises: 0023_registration_invitations
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_device_pairings"
down_revision: str | None = "0023_registration_invitations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_pairings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("protocol_version", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("scan_token_hash", sa.String(length=64), nullable=False),
        sa.Column("candidate_proof_hash", sa.String(length=64), nullable=True),
        sa.Column("candidate_device_name", sa.String(length=80), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("trusted_session_id", sa.Uuid(), nullable=True),
        sa.Column("trusted_device_id", sa.Uuid(), nullable=True),
        sa.Column("authorized_session_id", sa.Uuid(), nullable=True),
        sa.Column("authorized_device_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "protocol_version = 1",
            name=op.f("ck_device_pairings_protocol_version_supported"),
        ),
        sa.CheckConstraint(
            "purpose IN ('enrollment_request', 'enrollment_offer')",
            name=op.f("ck_device_pairings_purpose_supported"),
        ),
        sa.CheckConstraint(
            "status IN ('created', 'confirmation_pending', 'approved', "
            "'authorized', 'cancelled', 'expired')",
            name=op.f("ck_device_pairings_status_supported"),
        ),
        sa.CheckConstraint(
            "char_length(scan_token_hash) = 64",
            name=op.f("ck_device_pairings_scan_hash_length"),
        ),
        sa.CheckConstraint(
            "candidate_proof_hash IS NULL OR char_length(candidate_proof_hash) = 64",
            name=op.f("ck_device_pairings_proof_hash_length"),
        ),
        sa.CheckConstraint(
            "candidate_device_name IS NULL OR char_length(candidate_device_name) BETWEEN 1 AND 80",
            name=op.f("ck_device_pairings_candidate_name_length"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_device_pairings_expires_after_created"),
        ),
        sa.CheckConstraint(
            "(user_id IS NULL) = (trusted_session_id IS NULL) AND "
            "(user_id IS NULL) = (trusted_device_id IS NULL)",
            name=op.f("ck_device_pairings_trusted_binding_complete"),
        ),
        sa.CheckConstraint(
            "(candidate_proof_hash IS NULL) = (candidate_device_name IS NULL)",
            name=op.f("ck_device_pairings_candidate_binding_complete"),
        ),
        sa.CheckConstraint(
            "(status = 'authorized') = (authorized_at IS NOT NULL) AND "
            "(status = 'authorized') = (authorized_session_id IS NOT NULL) AND "
            "(status = 'authorized') = (authorized_device_id IS NOT NULL)",
            name=op.f("ck_device_pairings_authorized_binding_complete"),
        ),
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_device_pairings_cancelled_binding_complete"),
        ),
        sa.CheckConstraint(
            "(status = 'expired') = (expired_at IS NOT NULL)",
            name=op.f("ck_device_pairings_expired_binding_complete"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name=op.f("fk_device_pairings_user_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["trusted_session_id"],
            ["sessions.id"],
            ondelete="CASCADE",
            name=op.f("fk_device_pairings_trusted_session_id_sessions"),
        ),
        sa.ForeignKeyConstraint(
            ["trusted_device_id"],
            ["devices.id"],
            ondelete="CASCADE",
            name=op.f("fk_device_pairings_trusted_device_id_devices"),
        ),
        sa.ForeignKeyConstraint(
            ["authorized_session_id"],
            ["sessions.id"],
            ondelete="RESTRICT",
            name=op.f("fk_device_pairings_authorized_session_id_sessions"),
        ),
        sa.ForeignKeyConstraint(
            ["authorized_device_id"],
            ["devices.id"],
            ondelete="RESTRICT",
            name=op.f("fk_device_pairings_authorized_device_id_devices"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_pairings")),
        sa.UniqueConstraint("scan_token_hash", name=op.f("uq_device_pairings_scan_token_hash")),
        sa.UniqueConstraint(
            "candidate_proof_hash", name=op.f("uq_device_pairings_candidate_proof_hash")
        ),
    )
    op.create_index("ix_device_pairings_expires_at", "device_pairings", ["expires_at"])
    op.create_index(
        "ix_device_pairings_trusted_session_id",
        "device_pairings",
        ["trusted_session_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_device_pairings_trusted_session_id", table_name="device_pairings")
    op.drop_index("ix_device_pairings_expires_at", table_name="device_pairings")
    op.drop_table("device_pairings")
