"""Sync read/retention transaction boundary."""

from types import TracebackType
from typing import Protocol, Self

from messenger.application.ports.identity import UserRepository
from messenger.application.ports.sync.repository import SyncRepository


class SyncUnitOfWork(Protocol):
    users: UserRepository
    sync_events: SyncRepository

    async def __aenter__(self) -> Self: ...
    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...
    async def commit(self) -> None: ...


class SyncUnitOfWorkFactory(Protocol):
    def __call__(self) -> SyncUnitOfWork: ...
