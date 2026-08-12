"""Atomic bounded local filesystem adapter for opaque-key media."""

import hashlib
import os
from collections.abc import AsyncIterable, AsyncIterator
from pathlib import Path, PurePosixPath
from uuid import uuid4

import anyio

from messenger.application.ports.media_storage import (
    MediaIntegrityError,
    MediaNotFoundError,
    MediaTooLargeError,
    StoredMedia,
)


class LocalMediaStorage:
    def __init__(self, root: Path, *, read_chunk_bytes: int = 64 * 1024) -> None:
        self._root = root.resolve()
        self._read_chunk_bytes = read_chunk_bytes
        if read_chunk_bytes <= 0:
            raise ValueError("read chunk size must be positive")
        self._root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def new_storage_key(self) -> str:
        identifier = uuid4().hex
        return f"{identifier[:2]}/{identifier}"

    async def save(
        self,
        storage_key: str,
        chunks: AsyncIterable[bytes],
        *,
        expected_size: int,
        expected_sha256_hex: str,
        max_bytes: int,
    ) -> StoredMedia:
        destination = self._path(storage_key)
        await anyio.to_thread.run_sync(destination.parent.mkdir, 0o700, True, True)
        temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.part")
        digest = hashlib.sha256()
        size = 0
        try:
            async with await anyio.open_file(temporary, "xb") as output:
                await anyio.to_thread.run_sync(os.chmod, temporary, 0o600)
                async for chunk in chunks:
                    if not isinstance(chunk, bytes):
                        chunk = bytes(chunk)
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > max_bytes or size > expected_size:
                        raise MediaTooLargeError("media stream exceeded declared limit")
                    digest.update(chunk)
                    await output.write(chunk)
                await output.flush()
            actual_digest = digest.hexdigest()
            if size != expected_size or actual_digest != expected_sha256_hex:
                raise MediaIntegrityError("media stream size or digest mismatch")
            await anyio.to_thread.run_sync(os.replace, temporary, destination)
            return StoredMedia(size=size, sha256_hex=actual_digest)
        except BaseException:
            await self._unlink(temporary)
            raise

    async def open(self, storage_key: str) -> AsyncIterator[bytes]:
        path = self._path(storage_key)
        try:
            async with await anyio.open_file(path, "rb") as source:
                while chunk := await source.read(self._read_chunk_bytes):
                    yield chunk
        except FileNotFoundError as error:
            raise MediaNotFoundError("media object does not exist") from error

    async def delete(self, storage_key: str) -> None:
        await self._unlink(self._path(storage_key))

    async def exists(self, storage_key: str) -> bool:
        return await anyio.to_thread.run_sync(self._path(storage_key).is_file)

    def _path(self, storage_key: str) -> Path:
        relative = PurePosixPath(storage_key)
        if (
            relative.is_absolute()
            or len(relative.parts) != 2
            or any(part in {"", ".", ".."} for part in relative.parts)
        ):
            raise MediaIntegrityError("invalid opaque storage key")
        path = self._root.joinpath(*relative.parts).resolve()
        if not path.is_relative_to(self._root):
            raise MediaIntegrityError("opaque storage key escapes media root")
        return path

    @staticmethod
    async def _unlink(path: Path) -> None:
        try:
            await anyio.to_thread.run_sync(path.unlink)
        except FileNotFoundError:
            return
