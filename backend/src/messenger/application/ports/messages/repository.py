"""Opaque message repository port."""

from typing import Protocol

from messenger.domain.entities import Message


class MessageRepository(Protocol):
    async def add(self, message: Message) -> None: ...
