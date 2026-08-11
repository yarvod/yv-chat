"""Secure password-reset credential generation."""

import hashlib
import secrets

from messenger.application.ports.password_reset_secrets import GeneratedPasswordResetSecret


class SecurePasswordResetSecretService:
    """Generate 256-bit URL-safe reset secrets and SHA-256 lookup digests."""

    def generate(self) -> GeneratedPasswordResetSecret:
        plaintext = secrets.token_urlsafe(32)
        return GeneratedPasswordResetSecret(
            plaintext=plaintext,
            digest=self.digest(plaintext),
        )

    def digest(self, plaintext: str) -> str:
        return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()
