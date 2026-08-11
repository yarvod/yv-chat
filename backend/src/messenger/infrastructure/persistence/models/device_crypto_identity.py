"""Public device cryptography ORM models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from messenger.infrastructure.persistence.models.base import Base


class DeviceCryptoIdentityModel(Base):
    __tablename__ = "device_crypto_identities"
    __table_args__ = (
        ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["devices.id", "devices.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("protocol_version = 2", name="protocol_version_supported"),
        CheckConstraint(
            "octet_length(credential_identity) = 33",
            name="credential_identity_length",
        ),
        CheckConstraint(
            "octet_length(signature_public_key) = 32",
            name="signature_public_key_length",
        ),
        CheckConstraint("fingerprint ~ '^[0-9a-f]{64}$'", name="fingerprint_format"),
        UniqueConstraint("device_id", "user_id", name="uq_device_crypto_identity_owner"),
        UniqueConstraint("fingerprint", name="uq_device_crypto_identity_fingerprint"),
    )

    device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    protocol_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    credential_identity: Mapped[bytes] = mapped_column(LargeBinary(33), nullable=False)
    signature_public_key: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DeviceKeyPackageModel(Base):
    __tablename__ = "device_key_packages"
    __table_args__ = (
        ForeignKeyConstraint(
            ["device_id", "user_id"],
            ["device_crypto_identities.device_id", "device_crypto_identities.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("package_ref ~ '^[0-9a-f]{64}$'", name="package_ref_format"),
        CheckConstraint(
            "octet_length(key_package) BETWEEN 1 AND 1048576",
            name="key_package_length",
        ),
        UniqueConstraint("package_ref", name="uq_device_key_package_ref"),
        Index("ix_device_key_packages_device_created", "device_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    package_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    key_package: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
