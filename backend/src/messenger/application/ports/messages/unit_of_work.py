"""Message create transaction boundary."""

from types import TracebackType
from typing import Protocol, Self

from messenger.application.ports.conversations import ConversationRepository
from messenger.application.ports.identity import DeviceRepository, UserRepository
from messenger.application.ports.messages.repository import MessageRepository


class MessagingUnitOfWork(Protocol):
    messages: MessageRepository
    conversations: ConversationRepository
    users: UserRepository
    devices: DeviceRepository

    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None: ...


class MessagingUnitOfWorkFactory(Protocol):
    def __call__(self) -> MessagingUnitOfWork: ...
