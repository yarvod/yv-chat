"""Opaque-key media storage boundary independent of filesystem or S3."""

from collections.abc import AsyncIterable, AsyncIterator
from dataclasses import dataclass
from typing import Protocol


class MediaStorageError(Exception):
    """Base failure raised by a concrete media storage adapter."""


class MediaTooLargeError(MediaStorageError):
    """The streamed body exceeded its declared or configured limit."""


class MediaIntegrityError(MediaStorageError):
    """The streamed body did not match its declared size or digest."""


class MediaNotFoundError(MediaStorageError):
    """The requested opaque storage object does not exist."""


@dataclass(frozen=True, slots=True)
class StoredMedia:
    size: int
    sha256_hex: str


class MediaStorage(Protocol):
    def new_storage_key(self) -> str: ...

    async def save(
        self,
        storage_key: str,
        chunks: AsyncIterable[bytes],
        *,
        expected_size: int,
        expected_sha256_hex: str,
        max_bytes: int,
    ) -> StoredMedia: ...

    def open(self, storage_key: str) -> AsyncIterator[bytes]: ...

    async def delete(self, storage_key: str) -> None: ...

    async def exists(self, storage_key: str) -> bool: ...
