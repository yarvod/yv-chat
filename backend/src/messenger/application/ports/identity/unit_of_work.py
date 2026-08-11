"""Identity transaction boundary port."""

from types import TracebackType
from typing import Protocol, Self

from messenger.application.ports.identity.activation_tokens import ActivationTokenRepository
from messenger.application.ports.identity.devices import DeviceRepository
from messenger.application.ports.identity.security_events import SecurityEventRepository
from messenger.application.ports.identity.sessions import SessionRepository
from messenger.application.ports.identity.users import UserRepository


class IdentityUnitOfWork(Protocol):
    users: UserRepository
    activation_tokens: ActivationTokenRepository
    devices: DeviceRepository
    sessions: SessionRepository
    security_events: SecurityEventRepository

    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None: ...


class IdentityUnitOfWorkFactory(Protocol):
    def __call__(self) -> IdentityUnitOfWork: ...
