"""Authentication adapter tests."""

from messenger.infrastructure.auth.activation_secrets import SecureActivationSecretService
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService


async def test_activation_secret_is_high_entropy_and_only_digest_is_deterministic() -> None:
    service = SecureActivationSecretService()

    first = service.generate()
    second = service.generate()

    assert first.plaintext != second.plaintext
    assert len(first.digest) == 64
    assert first.digest == service.digest(first.plaintext)
    assert first.plaintext not in first.digest


async def test_argon2id_password_hash_roundtrip() -> None:
    hasher = Argon2PasswordHasher()
    password = "correct horse battery staple"

    password_hash = await hasher.hash(password)

    assert password_hash.startswith("$argon2id$")
    assert password not in password_hash
    assert await hasher.verify(password_hash, password) is True
    assert await hasher.verify(password_hash, "incorrect password") is False
    assert await hasher.verify("invalid-hash", password) is False
    assert await hasher.verify(None, password) is False


async def test_session_credential_is_high_entropy_and_only_digest_is_deterministic() -> None:
    service = SecureSessionCredentialService()

    first = service.generate()
    second = service.generate()

    assert first.plaintext != second.plaintext
    assert len(first.digest) == 64
    assert first.digest == service.digest(first.plaintext)
    assert first.plaintext not in first.digest
