"""Argon2id password hashing adapter."""

import asyncio
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


class Argon2PasswordHasher:
    """Run the maintained Argon2id implementation outside the event loop."""

    def __init__(self, hasher: PasswordHasher | None = None) -> None:
        self._hasher = hasher or PasswordHasher()
        self._dummy_hash: str | None = None

    async def hash(self, password: str) -> str:
        return await asyncio.to_thread(self._hasher.hash, password)

    async def verify(self, password_hash: str | None, password: str) -> bool:
        target_hash = password_hash
        if target_hash is None:
            if self._dummy_hash is None:
                self._dummy_hash = await asyncio.to_thread(
                    self._hasher.hash,
                    secrets.token_urlsafe(32),
                )
            target_hash = self._dummy_hash
        try:
            verified = await asyncio.to_thread(self._hasher.verify, target_hash, password)
        except (InvalidHashError, VerificationError):
            return False
        return password_hash is not None and verified
