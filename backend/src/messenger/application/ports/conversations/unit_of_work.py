"""Conversation transaction boundary port."""

from types import TracebackType
from typing import Protocol, Self

from messenger.application.ports.conversations.repository import ConversationRepository
from messenger.application.ports.identity import UserRepository


class ConversationUnitOfWork(Protocol):
    conversations: ConversationRepository
    users: UserRepository

    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None: ...


class ConversationUnitOfWorkFactory(Protocol):
    def __call__(self) -> ConversationUnitOfWork: ...
