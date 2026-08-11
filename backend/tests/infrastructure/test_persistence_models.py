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


def test_persistence_metadata_contains_expected_tables() -> None:
    assert set(Base.metadata.tables) == {
        "activation_tokens",
        "conversation_members",
        "conversations",
        "devices",
        "messages",
        "security_events",
        "sessions",
        "sync_events",
        "sync_streams",
        "users",
    }


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
    assert "revoked_at" in activation_tokens.columns
    assert activation_tokens.columns["token_hash"].unique is True


def test_session_schema_stores_only_hashes_and_binds_device_owner() -> None:
    sessions = Base.metadata.tables["sessions"]
    foreign_keys = {
        constraint.name: constraint
        for constraint in sessions.constraints
        if isinstance(constraint, ForeignKeyConstraint)
    }

    assert sessions.columns["current_token_hash"].unique is True
    assert sessions.columns["previous_token_hash"].unique is True
    assert "session_credential" not in sessions.columns
    assert foreign_keys["fk_sessions_device_owner_devices"].ondelete == "CASCADE"


def test_security_event_schema_is_typed_bounded_and_has_no_freeform_payload() -> None:
    security_events = Base.metadata.tables["security_events"]

    assert "event_type" in security_events.columns
    assert "expires_at" in security_events.columns
    assert "payload" not in security_events.columns
    assert "metadata" not in security_events.columns
    assert {
        "ix_security_events_expires_at",
        "ix_security_events_user_created_at",
    }.issubset({index.name for index in security_events.indexes})


def test_conversation_schema_enforces_direct_pair_and_membership_lifecycle() -> None:
    conversations = Base.metadata.tables["conversations"]
    members = Base.metadata.tables["conversation_members"]
    conversation_checks = {
        constraint.name
        for constraint in conversations.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert {
        "ck_conversations_direct_pair_ordered",
        "ck_conversations_shape_matches_type",
        "ck_conversations_title_length",
    }.issubset(conversation_checks)
    assert (
        next(
            index for index in conversations.indexes if index.name == "uq_conversations_direct_pair"
        ).unique
        is True
    )
    assert "ix_conversation_members_user_active" in {index.name for index in members.indexes}
    assert "plaintext" not in conversations.columns
    assert "message_key" not in conversations.columns


def test_message_schema_is_bounded_opaque_ciphertext_only() -> None:
    messages = Base.metadata.tables["messages"]
    check_names = {
        constraint.name
        for constraint in messages.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert "ciphertext" in messages.columns
    assert {
        "ck_messages_ciphertext_size",
        "ck_messages_protocol_version_range",
    }.issubset(check_names)
    assert {"plaintext", "text", "decrypted_body", "message_key"}.isdisjoint(messages.columns)
    assert "ix_messages_conversation_created" in {index.name for index in messages.indexes}


def test_sync_schema_has_per_user_cursor_and_opaque_routing_fields_only() -> None:
    streams = Base.metadata.tables["sync_streams"]
    events = Base.metadata.tables["sync_events"]

    assert set(streams.columns.keys()) == {"user_id", "last_cursor"}
    assert {column.name for column in events.primary_key} == {"user_id", "cursor"}
    assert {"event_id", "event_type", "conversation_id", "message_id"}.issubset(
        events.columns.keys()
    )
    assert {"ciphertext", "plaintext", "text", "message_key", "payload"}.isdisjoint(
        events.columns.keys()
    )
