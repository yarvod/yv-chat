"""Secure opaque session credential generation."""

import hashlib
import secrets

from messenger.application.ports.session_credentials import GeneratedSessionCredential


class SecureSessionCredentialService:
    """Generate 256-bit URL-safe credentials and SHA-256 lookup digests."""

    def generate(self) -> GeneratedSessionCredential:
        plaintext = secrets.token_urlsafe(32)
        return GeneratedSessionCredential(
            plaintext=plaintext,
            digest=self.digest(plaintext),
        )

    def digest(self, plaintext: str) -> str:
        return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()
