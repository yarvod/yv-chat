"""Opaque message persistence and transaction ports."""

from messenger.application.ports.messages.repository import MessageRepository
from messenger.application.ports.messages.unit_of_work import (
    MessagingUnitOfWork,
    MessagingUnitOfWorkFactory,
)

__all__ = ["MessageRepository", "MessagingUnitOfWork", "MessagingUnitOfWorkFactory"]
