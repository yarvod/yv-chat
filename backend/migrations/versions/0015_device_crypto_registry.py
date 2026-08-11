"""Add immutable public device cryptography registry.

Revision ID: 0015_device_crypto_registry
Revises: 0014_message_tombstones
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_device_crypto_registry"
down_revision: str | None = "0014_message_tombstones"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_crypto_identities",
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("protocol_version", sa.SmallInteger(), nullable=False),
        sa.Column("credential_identity", sa.LargeBinary(length=33), nullable=False),
        sa.Column("signature_public_key", sa.LargeBinary(length=32), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "protocol_version = 2",
            name=op.f("ck_device_crypto_identities_protocol_version_supported"),
        ),
        sa.CheckConstraint(
            "octet_length(credential_identity) = 33",
            name=op.f("ck_device_crypto_identities_credential_identity_length"),
        ),
        sa.CheckConstraint(
            "octet_length(signature_public_key) = 32",
            name=op.f("ck_device_crypto_identities_signature_public_key_length"),
        ),
        sa.CheckConstraint(
            "fingerprint ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_device_crypto_identities_fingerprint_format"),
        ),
        sa.ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["devices.id", "devices.user_id"],
            name=op.f("fk_device_crypto_identities_device_id_devices"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "device_id",
            name=op.f("pk_device_crypto_identities"),
        ),
        sa.UniqueConstraint(
            "device_id",
            "user_id",
            name="uq_device_crypto_identity_owner",
        ),
        sa.UniqueConstraint(
            "fingerprint",
            name="uq_device_crypto_identity_fingerprint",
        ),
    )
    op.create_table(
        "device_key_packages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("package_ref", sa.String(length=64), nullable=False),
        sa.Column("key_package", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "package_ref ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_device_key_packages_package_ref_format"),
        ),
        sa.CheckConstraint(
            "octet_length(key_package) BETWEEN 1 AND 1048576",
            name=op.f("ck_device_key_packages_key_package_length"),
        ),
        sa.ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["device_crypto_identities.device_id", "device_crypto_identities.user_id"],
            name=op.f("fk_device_key_packages_device_id_device_crypto_identities"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_key_packages")),
        sa.UniqueConstraint("package_ref", name="uq_device_key_package_ref"),
    )
    op.create_index(
        "ix_device_key_packages_device_created",
        "device_key_packages",
        ["device_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_device_key_packages_device_created",
        table_name="device_key_packages",
    )
    op.drop_table("device_key_packages")
    op.drop_table("device_crypto_identities")
