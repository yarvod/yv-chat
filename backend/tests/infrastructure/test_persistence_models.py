"""Persistence metadata contract tests."""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index

from messenger.infrastructure.persistence.models import Base

FORBIDDEN_COLUMNS = {
    "decrypted_body",
    "message_key",
    "password",
    "plaintext",
    "private_key",
    "session_token",
    "text",
}


def test_identity_metadata_contains_expected_tables() -> None:
    assert set(Base.metadata.tables) == {"activation_tokens", "devices", "users"}


def test_user_schema_enforces_normalized_unique_username() -> None:
    users = Base.metadata.tables["users"]
    check_names = {
        constraint.name
        for constraint in users.constraints
        if isinstance(constraint, CheckConstraint)
    }
    username_index = next(
        index
        for index in users.indexes
        if isinstance(index, Index) and index.name == "uq_users_username_lower"
    )

    assert "ck_users_username_length" in check_names
    assert "ck_users_username_normalized" in check_names
    assert username_index.unique is True


def test_device_schema_cascades_with_user_and_indexes_ownership() -> None:
    devices = Base.metadata.tables["devices"]
    foreign_key = next(
        constraint
        for constraint in devices.constraints
        if isinstance(constraint, ForeignKeyConstraint)
    )

    assert foreign_key.ondelete == "CASCADE"
    assert "ix_devices_user_id" in {index.name for index in devices.indexes}


def test_identity_schema_has_no_secret_or_plaintext_columns() -> None:
    actual_columns = {
        column.name for table in Base.metadata.tables.values() for column in table.columns
    }

    assert actual_columns.isdisjoint(FORBIDDEN_COLUMNS)


def test_activation_schema_stores_digest_without_plaintext_secret() -> None:
    activation_tokens = Base.metadata.tables["activation_tokens"]

    assert "token_hash" in activation_tokens.columns
    assert "activation_secret" not in activation_tokens.columns
    assert "token" not in activation_tokens.columns
    assert activation_tokens.columns["token_hash"].unique is True
