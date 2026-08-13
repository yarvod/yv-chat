"""Identity transaction boundary port."""

from __future__ import annotations

from types import TracebackType
from typing import TYPE_CHECKING, Protocol, Self

from messenger.application.ports.identity.activation_tokens import ActivationTokenRepository
from messenger.application.ports.identity.device_history_chunks import DeviceHistoryChunkRepository
from messenger.application.ports.identity.device_pairings import DevicePairingRepository
from messenger.application.ports.identity.devices import DeviceRepository
from messenger.application.ports.identity.password_reset_tokens import PasswordResetTokenRepository
from messenger.application.ports.identity.registration_invitations import (
    RegistrationInvitationRepository,
)
from messenger.application.ports.identity.security_events import SecurityEventRepository
from messenger.application.ports.identity.sessions import SessionRepository
from messenger.application.ports.identity.users import UserRepository

if TYPE_CHECKING:
    from messenger.application.ports.conversations import ConversationRepository
    from messenger.application.ports.sync import SyncRepository


class IdentityUnitOfWork(Protocol):
    users: UserRepository
    activation_tokens: ActivationTokenRepository
    devices: DeviceRepository
    device_pairings: DevicePairingRepository
    device_history_chunks: DeviceHistoryChunkRepository
    password_reset_tokens: PasswordResetTokenRepository
    registration_invitations: RegistrationInvitationRepository
    sessions: SessionRepository
    security_events: SecurityEventRepository
    conversations: ConversationRepository
    sync_events: SyncRepository

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
