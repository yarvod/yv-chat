"""Opaque session credential boundary."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class GeneratedSessionCredential:
    """Plaintext is returned once; only digest crosses into persistence."""

    plaintext: str
    digest: str


class SessionCredentialService(Protocol):
    """Generate high-entropy credentials and deterministic lookup digests."""

    def generate(self) -> GeneratedSessionCredential:
        """Generate one credential and its persistence-safe digest."""
        ...

    def digest(self, plaintext: str) -> str:
        """Derive a lookup digest for a presented credential."""
        ...
