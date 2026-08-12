"""Message create transaction boundary."""

from types import TracebackType
from typing import Protocol, Self

from messenger.application.ports.attachments import AttachmentRepository
from messenger.application.ports.conversation_crypto import (
    ConversationCryptoGenerationRepository,
    ConversationCryptoRequiredDeviceRepository,
)
from messenger.application.ports.conversations import ConversationRepository
from messenger.application.ports.device_crypto import DeviceCryptoIdentityRepository
from messenger.application.ports.identity import DeviceRepository, UserRepository
from messenger.application.ports.messages.delivery_states import ConversationDeliveryStateRepository
from messenger.application.ports.messages.reactions import MessageReactionRepository
from messenger.application.ports.messages.read_states import ConversationReadStateRepository
from messenger.application.ports.messages.repository import MessageRepository
from messenger.application.ports.sync import SyncRepository


class MessagingUnitOfWork(Protocol):
    messages: MessageRepository
    read_states: ConversationReadStateRepository
    delivery_states: ConversationDeliveryStateRepository
    conversations: ConversationRepository
    users: UserRepository
    devices: DeviceRepository
    sync_events: SyncRepository
    crypto_generations: ConversationCryptoGenerationRepository
    crypto_required_devices: ConversationCryptoRequiredDeviceRepository
    crypto_identities: DeviceCryptoIdentityRepository
    attachments: AttachmentRepository
    reactions: MessageReactionRepository

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
