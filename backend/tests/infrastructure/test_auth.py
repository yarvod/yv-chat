"""Authentication adapter tests."""

import asyncio

from messenger.infrastructure.auth.activation_secrets import SecureActivationSecretService
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher


def test_activation_secret_is_high_entropy_and_only_digest_is_deterministic() -> None:
    service = SecureActivationSecretService()

    first = service.generate()
    second = service.generate()

    assert first.plaintext != second.plaintext
    assert len(first.digest) == 64
    assert first.digest == service.digest(first.plaintext)
    assert first.plaintext not in first.digest


def test_argon2id_password_hash_roundtrip() -> None:
    hasher = Argon2PasswordHasher()
    password = "correct horse battery staple"

    password_hash = asyncio.run(hasher.hash(password))

    assert password_hash.startswith("$argon2id$")
    assert password not in password_hash
    assert asyncio.run(hasher.verify(password_hash, password)) is True
    assert asyncio.run(hasher.verify(password_hash, "incorrect password")) is False
    assert asyncio.run(hasher.verify("invalid-hash", password)) is False
