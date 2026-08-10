"""Password hashing boundary."""

from typing import Protocol


class PasswordHasher(Protocol):
    """Hash and verify authentication passwords outside the event loop."""

    async def hash(self, password: str) -> str:
        """Return a modern password hash."""
        ...

    async def verify(self, password_hash: str, password: str) -> bool:
        """Verify a password without exposing it."""
        ...
