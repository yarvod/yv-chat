"""Password-reset credential generation and lookup hashing boundary."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class GeneratedPasswordResetSecret:
    """Plaintext returned once and its persistent lookup digest."""

    plaintext: str
    digest: str


class PasswordResetSecretService(Protocol):
    """Purpose-specific high-entropy reset secret adapter."""

    def generate(self) -> GeneratedPasswordResetSecret: ...

    def digest(self, plaintext: str) -> str: ...
