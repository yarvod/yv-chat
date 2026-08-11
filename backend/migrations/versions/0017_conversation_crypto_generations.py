"""Add opaque MLS conversation generation coordination.

Revision ID: 0017_conversation_crypto
Revises: 0016_key_package_claims
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_conversation_crypto"
down_revision: str | None = "0016_key_package_claims"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversation_crypto_generations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("generation_number", sa.BigInteger(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("coordinator_user_id", sa.Uuid(), nullable=False),
        sa.Column("coordinator_device_id", sa.Uuid(), nullable=False),
        sa.Column("bootstrap_request_id", sa.Uuid(), nullable=False),
        sa.Column("protocol_version", sa.SmallInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("epoch", sa.BigInteger(), nullable=True),
        sa.Column("commit_message", sa.LargeBinary(), nullable=True),
        sa.Column("ratchet_tree", sa.LargeBinary(), nullable=True),
        sa.Column("block_reason", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "generation_number > 0",
            name=op.f("ck_conversation_crypto_generations_generation_number_positive"),
        ),
        sa.CheckConstraint(
            "protocol_version = 2",
            name=op.f("ck_conversation_crypto_generations_protocol_version_supported"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'ready', 'blocked')",
            name=op.f("ck_conversation_crypto_generations_status_allowed"),
        ),
        sa.CheckConstraint(
            "block_reason IS NULL OR block_reason IN "
            "('missing_identity', 'missing_key_package', 'membership_changed', "
            "'device_roster_changed', 'coordinator_revoked', 'protocol_failure')",
            name=op.f("ck_conversation_crypto_generations_block_reason_allowed"),
        ),
        sa.CheckConstraint(
            "epoch IS NULL OR epoch > 0",
            name=op.f("ck_conversation_crypto_generations_epoch_positive"),
        ),
        sa.CheckConstraint(
            "updated_at >= created_at",
            name=op.f("ck_conversation_crypto_generations_updated_after_created"),
        ),
        sa.CheckConstraint(
            "ready_at IS NULL OR (ready_at >= created_at AND updated_at >= ready_at)",
            name=op.f("ck_conversation_crypto_generations_ready_time_consistent"),
        ),
        sa.CheckConstraint(
            "(commit_message IS NULL) = (ratchet_tree IS NULL)",
            name=op.f("ck_conversation_crypto_generations_opaque_payload_complete"),
        ),
        sa.CheckConstraint(
            "commit_message IS NULL OR octet_length(commit_message) BETWEEN 1 AND 1048576",
            name=op.f("ck_conversation_crypto_generations_commit_message_length"),
        ),
        sa.CheckConstraint(
            "ratchet_tree IS NULL OR octet_length(ratchet_tree) BETWEEN 1 AND 1048576",
            name=op.f("ck_conversation_crypto_generations_ratchet_tree_length"),
        ),
        sa.CheckConstraint(
            "(status = 'pending' AND epoch IS NULL AND commit_message IS NULL "
            "AND ready_at IS NULL AND block_reason IS NULL) OR "
            "(status = 'ready' AND epoch > 0 AND commit_message IS NOT NULL "
            "AND ready_at IS NOT NULL AND block_reason IS NULL) OR "
            "(status = 'blocked' AND block_reason IS NOT NULL AND "
            "((epoch IS NULL AND commit_message IS NULL AND ready_at IS NULL) OR "
            "(epoch > 0 AND commit_message IS NOT NULL AND ready_at IS NOT NULL)))",
            name=op.f("ck_conversation_crypto_generations_shape_matches_status"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_conversation_crypto_generations_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["coordinator_device_id", "coordinator_user_id"],
            ["devices.id", "devices.user_id"],
            name=op.f("fk_conversation_crypto_generations_coordinator_device_id_devices"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversation_crypto_generations")),
        sa.UniqueConstraint(
            "conversation_id",
            "generation_number",
            name="uq_conversation_crypto_generation_number",
        ),
        sa.UniqueConstraint(
            "coordinator_device_id",
            "bootstrap_request_id",
            name="uq_conversation_crypto_bootstrap_request",
        ),
    )
    op.create_index(
        "uq_conversation_crypto_current",
        "conversation_crypto_generations",
        ["conversation_id"],
        unique=True,
        postgresql_where=sa.text("is_current"),
    )
    op.create_index(
        "ix_conversation_crypto_status",
        "conversation_crypto_generations",
        ["status", "updated_at"],
    )
    op.create_table(
        "conversation_crypto_required_devices",
        sa.Column("generation_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("is_coordinator", sa.Boolean(), nullable=False),
        sa.Column("key_package_id", sa.Uuid(), nullable=True),
        sa.Column("snapshot_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "NOT is_coordinator OR key_package_id IS NULL",
            name=op.f("ck_conversation_crypto_required_devices_coordinator_has_no_key_package"),
        ),
        sa.ForeignKeyConstraint(
            ["generation_id"],
            ["conversation_crypto_generations.id"],
            name=op.f(
                "fk_conversation_crypto_required_devices_generation_id_"
                "conversation_crypto_generations"
            ),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["devices.id", "devices.user_id"],
            name=op.f("fk_conversation_crypto_required_devices_device_id_devices"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["key_package_id"],
            ["device_key_packages.id"],
            name=op.f("fk_conversation_crypto_required_devices_key_package_id_device_key_packages"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "generation_id",
            "device_id",
            name=op.f("pk_conversation_crypto_required_devices"),
        ),
        sa.UniqueConstraint(
            "key_package_id",
            name="uq_conversation_crypto_required_package",
        ),
    )
    op.create_index(
        "ix_conversation_crypto_required_user",
        "conversation_crypto_required_devices",
        ["user_id", "generation_id"],
    )
    op.create_table(
        "conversation_crypto_welcomes",
        sa.Column("generation_id", sa.Uuid(), nullable=False),
        sa.Column("target_device_id", sa.Uuid(), nullable=False),
        sa.Column("welcome_message", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "octet_length(welcome_message) BETWEEN 1 AND 1048576",
            name=op.f("ck_conversation_crypto_welcomes_welcome_message_length"),
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_conversation_crypto_welcomes_expires_after_created"),
        ),
        sa.CheckConstraint(
            "acknowledged_at IS NULL OR "
            "(acknowledged_at >= created_at AND acknowledged_at < expires_at)",
            name=op.f("ck_conversation_crypto_welcomes_acknowledgement_time_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["generation_id", "target_device_id"],
            [
                "conversation_crypto_required_devices.generation_id",
                "conversation_crypto_required_devices.device_id",
            ],
            name=op.f(
                "fk_conversation_crypto_welcomes_generation_id_conversation_crypto_required_devices"
            ),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "generation_id",
            "target_device_id",
            name=op.f("pk_conversation_crypto_welcomes"),
        ),
    )
    op.create_index(
        "ix_conversation_crypto_welcomes_pending",
        "conversation_crypto_welcomes",
        ["target_device_id", "expires_at"],
        postgresql_where=sa.text("acknowledged_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_conversation_crypto_welcomes_pending",
        table_name="conversation_crypto_welcomes",
    )
    op.drop_table("conversation_crypto_welcomes")
    op.drop_index(
        "ix_conversation_crypto_required_user",
        table_name="conversation_crypto_required_devices",
    )
    op.drop_table("conversation_crypto_required_devices")
    op.drop_index(
        "ix_conversation_crypto_status",
        table_name="conversation_crypto_generations",
    )
    op.drop_index(
        "uq_conversation_crypto_current",
        table_name="conversation_crypto_generations",
    )
    op.drop_table("conversation_crypto_generations")
