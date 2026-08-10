"""Secure activation secret generation."""

import hashlib
import secrets

from messenger.application.ports.activation_secrets import GeneratedActivationSecret


class SecureActivationSecretService:
    """Generate 256-bit URL-safe secrets and SHA-256 lookup digests."""

    def generate(self) -> GeneratedActivationSecret:
        plaintext = secrets.token_urlsafe(32)
        return GeneratedActivationSecret(
            plaintext=plaintext,
            digest=self.digest(plaintext),
        )

    def digest(self, plaintext: str) -> str:
        return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()
