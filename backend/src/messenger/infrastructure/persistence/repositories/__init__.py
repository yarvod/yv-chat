"""SQLAlchemy repository adapters grouped by aggregate responsibility."""

from messenger.infrastructure.persistence.repositories.activation_tokens import (
    SqlAlchemyActivationTokenRepository,
)
from messenger.infrastructure.persistence.repositories.devices import SqlAlchemyDeviceRepository
from messenger.infrastructure.persistence.repositories.security_events import (
    SqlAlchemySecurityEventRepository,
)
from messenger.infrastructure.persistence.repositories.sessions import SqlAlchemySessionRepository
from messenger.infrastructure.persistence.repositories.users import SqlAlchemyUserRepository

__all__ = [
    "SqlAlchemyActivationTokenRepository",
    "SqlAlchemyDeviceRepository",
    "SqlAlchemySecurityEventRepository",
    "SqlAlchemySessionRepository",
    "SqlAlchemyUserRepository",
]
