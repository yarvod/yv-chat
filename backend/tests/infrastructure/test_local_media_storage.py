"""Local media adapter atomicity and opaque-key boundary tests."""

import hashlib
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from messenger.application.ports.media_storage import MediaIntegrityError
from messenger.infrastructure.media.local import LocalMediaStorage


async def chunks(*parts: bytes) -> AsyncIterator[bytes]:
    for part in parts:
        yield part


async def test_local_media_storage_streams_atomically_and_tolerates_missing_delete(
    tmp_path: Path,
) -> None:
    storage = LocalMediaStorage(tmp_path, read_chunk_bytes=3)
    body = b"abcdefgh"
    storage_key = storage.new_storage_key()

    stored = await storage.save(
        storage_key,
        chunks(b"abc", b"defgh"),
        expected_size=len(body),
        expected_sha256_hex=hashlib.sha256(body).hexdigest(),
        max_bytes=len(body),
    )

    assert stored.size == len(body)
    assert b"".join([chunk async for chunk in storage.open(storage_key)]) == body
    await storage.delete(storage_key)
    await storage.delete(storage_key)
    assert not await storage.exists(storage_key)


async def test_local_media_storage_rejects_traversal_and_removes_partial_write(
    tmp_path: Path,
) -> None:
    storage = LocalMediaStorage(tmp_path)

    with pytest.raises(MediaIntegrityError):
        await storage.save(
            "../escape",
            chunks(b"bad"),
            expected_size=3,
            expected_sha256_hex=hashlib.sha256(b"bad").hexdigest(),
            max_bytes=3,
        )
    key = storage.new_storage_key()
    with pytest.raises(MediaIntegrityError):
        await storage.save(
            key,
            chunks(b"partial"),
            expected_size=99,
            expected_sha256_hex="0" * 64,
            max_bytes=99,
        )
    assert list(tmp_path.rglob("*.part")) == []
    assert not await storage.exists(key)
