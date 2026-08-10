"""Argon2id password hashing adapter."""

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


class Argon2PasswordHasher:
    """Run the maintained Argon2id implementation outside the event loop."""

    def __init__(self, hasher: PasswordHasher | None = None) -> None:
        self._hasher = hasher or PasswordHasher()

    async def hash(self, password: str) -> str:
        return await asyncio.to_thread(self._hasher.hash, password)

    async def verify(self, password_hash: str, password: str) -> bool:
        try:
            return await asyncio.to_thread(self._hasher.verify, password_hash, password)
        except (InvalidHashError, VerificationError):
            return False
