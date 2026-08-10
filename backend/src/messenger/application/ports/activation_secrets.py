"""Activation secret generation and lookup hashing boundary."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class GeneratedActivationSecret:
    """Plaintext returned once and its persistent lookup digest."""

    plaintext: str
    digest: str


class ActivationSecretService(Protocol):
    """Generate high-entropy secrets and deterministic lookup digests."""

    def generate(self) -> GeneratedActivationSecret:
        """Generate a new secret and SHA-256 digest."""
        ...

    def digest(self, plaintext: str) -> str:
        """Hash a presented secret for database lookup."""
        ...
