"""Persistence metadata contract tests."""

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index

from messenger.infrastructure.persistence.models import Base

FORBIDDEN_COLUMNS = {
    "decrypted_body",
    "message_key",
    "password",
    "plaintext",
    "private_key",
    "sealed_state",
    "session_token",
    "text",
    "wrapping_key",
}


def test_persistence_metadata_contains_expected_tables() -> None:
    assert set(Base.metadata.tables) == {
        "activation_tokens",
        "attachments",
        "conversation_members",
        "conversation_delivery_states",
        "conversation_crypto_generations",
        "conversation_crypto_required_devices",
        "conversation_crypto_welcomes",
        "conversation_read_states",
        "conversations",
        "devices",
        "device_crypto_identities",
        "device_key_packages",
        "messages",
        "password_reset_tokens",
        "security_events",
        "sessions",
        "sync_events",
        "sync_streams",
        "users",
    }


def test_attachment_schema_keeps_only_opaque_storage_and_bounded_routing_metadata() -> None:
    attachments = Base.metadata.tables["attachments"]

    assert set(attachments.columns.keys()) == {
        "byte_size",
        "client_attachment_id",
        "committed_message_id",
        "content_type",
        "conversation_id",
        "created_at",
        "expires_at",
        "id",
        "media_kind",
        "sha256_digest",
        "storage_key",
        "uploader_device_id",
        "uploader_user_id",
    }
    assert not (set(attachments.columns.keys()) & FORBIDDEN_COLUMNS)


def test_device_crypto_schema_contains_only_public_bounded_material() -> None:
    identities = Base.metadata.tables["device_crypto_identities"]
    key_packages = Base.metadata.tables["device_key_packages"]
    identity_checks = {
        constraint.name
        for constraint in identities.constraints
        if isinstance(constraint, CheckConstraint)
    }
    package_checks = {
        constraint.name
        for constraint in key_packages.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert set(identities.columns.keys()) == {
        "created_at",
        "credential_identity",
        "device_id",
        "fingerprint",
        "protocol_version",
        "signature_public_key",
        "user_id",
    }
    assert {
        "ck_device_crypto_identities_credential_identity_length",
        "ck_device_crypto_identities_fingerprint_format",
        "ck_device_crypto_identities_protocol_version_supported",
        "ck_device_crypto_identities_signature_public_key_length",
    }.issubset(identity_checks)
    assert set(key_packages.columns.keys()) == {
        "claim_conversation_id",
        "claim_request_id",
        "claimed_at",
        "claimed_by_device_id",
        "claimed_by_user_id",
        "created_at",
        "device_id",
        "id",
        "key_package",
        "package_ref",
        "user_id",
    }
    assert {
        "ck_device_key_packages_claim_metadata_complete",
        "ck_device_key_packages_claiming_device_differs",
        "ck_device_key_packages_claimed_after_created",
        "ck_device_key_packages_key_package_length",
    }.issubset(package_checks)
    assert "ix_device_key_packages_available" in {index.name for index in key_packages.indexes}
    assert {"private_key", "sealed_state", "wrapping_key"}.isdisjoint(
        set(identities.columns.keys()) | set(key_packages.columns.keys())
    )


def test_conversation_crypto_schema_stores_only_bounded_public_mls_wire_data() -> None:
    generations = Base.metadata.tables["conversation_crypto_generations"]
    required_devices = Base.metadata.tables["conversation_crypto_required_devices"]
    welcomes = Base.metadata.tables["conversation_crypto_welcomes"]

    assert {"commit_message", "ratchet_tree"}.issubset(generations.columns.keys())
    assert {"generation_id", "device_id", "key_package_id"}.issubset(
        required_devices.columns.keys()
    )
    assert {"welcome_message", "expires_at", "acknowledged_at"}.issubset(welcomes.columns.keys())
    all_columns = (
        set(generations.columns.keys())
        | set(required_devices.columns.keys())
        | set(welcomes.columns.keys())
    )
    assert {"plaintext", "message_key", "private_key", "sealed_state"}.isdisjoint(all_columns)


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


def test_password_reset_schema_is_purpose_bound_and_stores_only_digest() -> None:
    reset_tokens = Base.metadata.tables["password_reset_tokens"]

    assert "token_hash" in reset_tokens.columns
    assert "reset_secret" not in reset_tokens.columns
    assert "token" not in reset_tokens.columns
    assert "used_at" in reset_tokens.columns
    assert "revoked_at" in reset_tokens.columns
    assert reset_tokens.columns["token_hash"].unique is True


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
        "ck_conversations_last_message_sequence_non_negative",
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
        "ck_messages_ciphertext_digest_format",
        "ck_messages_expires_after_created",
        "ck_messages_protocol_version_range",
        "ck_messages_tombstone_shape",
    }.issubset(check_names)
    assert messages.columns["ciphertext"].nullable is True
    assert {
        "ciphertext_digest",
        "expires_at",
        "deletion_reason",
        "deleted_at",
        "deleted_by_user_id",
        "tombstone_expires_at",
    }.issubset(messages.columns.keys())
    assert {"plaintext", "text", "decrypted_body", "message_key"}.isdisjoint(messages.columns)
    assert {
        "ix_messages_conversation_created",
        "ix_messages_expiry_active",
        "ix_messages_tombstone_expiry",
    }.issubset({index.name for index in messages.indexes})


def test_sync_schema_has_per_user_cursor_and_opaque_routing_fields_only() -> None:
    streams = Base.metadata.tables["sync_streams"]
    events = Base.metadata.tables["sync_events"]

    assert set(streams.columns.keys()) == {"user_id", "last_cursor"}
    assert {column.name for column in events.primary_key} == {"user_id", "cursor"}
    assert {
        "event_id",
        "event_type",
        "conversation_id",
        "message_id",
        "actor_user_id",
        "read_sequence",
        "delivery_sequence",
    }.issubset(events.columns.keys())
    assert {"ciphertext", "plaintext", "text", "message_key", "payload"}.isdisjoint(
        events.columns.keys()
    )


def test_read_state_schema_is_user_scoped_and_monotonic() -> None:
    read_states = Base.metadata.tables["conversation_read_states"]
    check_names = {
        constraint.name
        for constraint in read_states.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert {column.name for column in read_states.primary_key} == {
        "user_id",
        "conversation_id",
    }
    assert "ck_conversation_read_states_last_read_sequence_positive" in check_names
    assert "ix_read_states_conversation" in {index.name for index in read_states.indexes}


def test_delivery_state_schema_is_device_scoped_and_monotonic() -> None:
    delivery_states = Base.metadata.tables["conversation_delivery_states"]
    check_names = {
        constraint.name
        for constraint in delivery_states.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert {column.name for column in delivery_states.primary_key} == {
        "device_id",
        "conversation_id",
    }
    assert "ck_conversation_delivery_states_last_delivered_sequence_positive" in check_names
    assert "ix_delivery_states_conversation" in {index.name for index in delivery_states.indexes}
