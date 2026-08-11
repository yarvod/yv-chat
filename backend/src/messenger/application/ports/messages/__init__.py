"""Opaque message persistence and transaction ports."""

from messenger.application.ports.messages.delivery_states import (
    ConversationDeliveryStateRepository,
    ParticipantDeliverySummary,
)
from messenger.application.ports.messages.read_states import (
    ConversationReadStateRepository,
    ConversationReadSummary,
)
from messenger.application.ports.messages.repository import MessageRepository
from messenger.application.ports.messages.unit_of_work import (
    MessagingUnitOfWork,
    MessagingUnitOfWorkFactory,
)

__all__ = [
    "ConversationDeliveryStateRepository",
    "ConversationReadStateRepository",
    "ConversationReadSummary",
    "ParticipantDeliverySummary",
    "MessageRepository",
    "MessagingUnitOfWork",
    "MessagingUnitOfWorkFactory",
]
