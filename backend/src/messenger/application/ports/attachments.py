"""Attachment persistence transaction boundary."""

from __future__ import annotations

from datetime import datetime
from types import TracebackType
from typing import TYPE_CHECKING, Protocol, Self
from uuid import UUID

from messenger.application.ports.conversations import ConversationRepository
from messenger.application.ports.identity import DeviceRepository, UserRepository
from messenger.domain.entities import Attachment

if TYPE_CHECKING:
    from messenger.application.ports.messages.repository import MessageRepository


class AttachmentRepository(Protocol):
    async def add(self, attachment: Attachment) -> None: ...

    async def get_by_id(
        self,
        attachment_id: UUID,
        *,
        for_update: bool = False,
    ) -> Attachment | None: ...

    async def get_by_client_id(
        self,
        *,
        uploader_device_id: UUID,
        client_attachment_id: UUID,
        for_update: bool = False,
    ) -> Attachment | None: ...

    async def get_many_for_update(self, attachment_ids: tuple[UUID, ...]) -> list[Attachment]: ...

    async def list_for_message(self, message_id: UUID) -> list[Attachment]: ...

    async def active_bytes_for_user(self, *, user_id: UUID, now: datetime) -> int: ...

    async def update(self, attachment: Attachment) -> None: ...

    async def list_expired(self, *, now: datetime, limit: int) -> list[Attachment]: ...

    async def delete(self, attachment_id: UUID) -> None: ...

    async def align_committed_expiry_with_active_messages(self) -> int: ...


class AttachmentUnitOfWork(Protocol):
    attachments: AttachmentRepository
    conversations: ConversationRepository
    users: UserRepository
    devices: DeviceRepository
    messages: MessageRepository

    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None: ...


class AttachmentUnitOfWorkFactory(Protocol):
    def __call__(self) -> AttachmentUnitOfWork: ...
