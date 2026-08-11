"""Domain invariants for immutable public device crypto records."""

from datetime import UTC, datetime
from uuid import UUID

import pytest

from messenger.domain.entities.device_crypto_identity import (
    DeviceCryptoIdentity,
    DeviceKeyPackage,
    expected_credential_identity,
    public_fingerprint,
)
from messenger.domain.exceptions import DomainValidationError

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
USER_ID = UUID("1b0a32e8-144f-4f60-bcb6-112f71bd5316")
DEVICE_ID = UUID("50d6b08a-84ae-4bd7-829a-f40f38e9a2c1")


def test_public_identity_derives_canonical_owner_and_fingerprint() -> None:
    credential = expected_credential_identity(USER_ID, DEVICE_ID)
    signature_key = bytes(range(32))
    identity = DeviceCryptoIdentity.create(
        user_id=USER_ID,
        device_id=DEVICE_ID,
        credential_identity=credential,
        signature_public_key=signature_key,
        now=NOW,
    )

    assert credential == b"\x01" + USER_ID.bytes + DEVICE_ID.bytes
    assert identity.protocol_version == 2
    assert identity.fingerprint == public_fingerprint(credential, signature_key)
    assert identity.matches(identity)


@pytest.mark.parametrize(
    ("credential", "signature_key"),
    [
        (b"\x01" + USER_ID.bytes + UUID(int=0).bytes, bytes(32)),
        (expected_credential_identity(USER_ID, DEVICE_ID), bytes(31)),
    ],
)
def test_public_identity_rejects_wrong_owner_or_key_length(
    credential: bytes,
    signature_key: bytes,
) -> None:
    with pytest.raises(DomainValidationError):
        DeviceCryptoIdentity.create(
            user_id=USER_ID,
            device_id=DEVICE_ID,
            credential_identity=credential,
            signature_public_key=signature_key,
            now=NOW,
        )


def test_key_package_reference_is_server_derived_and_bounded() -> None:
    package = DeviceKeyPackage.create(
        user_id=USER_ID,
        device_id=DEVICE_ID,
        key_package=b"opaque-public-key-package",
        now=NOW,
    )
    assert len(package.package_ref) == 64

    with pytest.raises(DomainValidationError):
        DeviceKeyPackage.create(
            user_id=USER_ID,
            device_id=DEVICE_ID,
            key_package=b"",
            now=NOW,
        )
