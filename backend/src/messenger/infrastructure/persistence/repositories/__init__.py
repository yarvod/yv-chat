"""SQLAlchemy repository adapters grouped by aggregate responsibility."""

from messenger.infrastructure.persistence.repositories.activation_tokens import (
    SqlAlchemyActivationTokenRepository,
)
from messenger.infrastructure.persistence.repositories.attachments import (
    SqlAlchemyAttachmentRepository,
)
from messenger.infrastructure.persistence.repositories.conversation_crypto import (
    SqlAlchemyConversationCryptoGenerationRepository,
    SqlAlchemyConversationCryptoRequiredDeviceRepository,
    SqlAlchemyConversationCryptoWelcomeRepository,
)
from messenger.infrastructure.persistence.repositories.conversation_delivery_states import (
    SqlAlchemyConversationDeliveryStateRepository,
)
from messenger.infrastructure.persistence.repositories.conversation_read_states import (
    SqlAlchemyConversationReadStateRepository,
)
from messenger.infrastructure.persistence.repositories.conversations import (
    SqlAlchemyConversationRepository,
)
from messenger.infrastructure.persistence.repositories.device_crypto import (
    SqlAlchemyDeviceCryptoIdentityRepository,
    SqlAlchemyDeviceKeyPackageRepository,
)
from messenger.infrastructure.persistence.repositories.devices import SqlAlchemyDeviceRepository
from messenger.infrastructure.persistence.repositories.messages import SqlAlchemyMessageRepository
from messenger.infrastructure.persistence.repositories.password_reset_tokens import (
    SqlAlchemyPasswordResetTokenRepository,
)
from messenger.infrastructure.persistence.repositories.security_events import (
    SqlAlchemySecurityEventRepository,
)
from messenger.infrastructure.persistence.repositories.sessions import SqlAlchemySessionRepository
from messenger.infrastructure.persistence.repositories.sync import SqlAlchemySyncRepository
from messenger.infrastructure.persistence.repositories.users import SqlAlchemyUserRepository

__all__ = [
    "SqlAlchemyActivationTokenRepository",
    "SqlAlchemyAttachmentRepository",
    "SqlAlchemyConversationRepository",
    "SqlAlchemyConversationCryptoGenerationRepository",
    "SqlAlchemyConversationCryptoRequiredDeviceRepository",
    "SqlAlchemyConversationCryptoWelcomeRepository",
    "SqlAlchemyConversationDeliveryStateRepository",
    "SqlAlchemyConversationReadStateRepository",
    "SqlAlchemyDeviceCryptoIdentityRepository",
    "SqlAlchemyDeviceKeyPackageRepository",
    "SqlAlchemyDeviceRepository",
    "SqlAlchemyMessageRepository",
    "SqlAlchemyPasswordResetTokenRepository",
    "SqlAlchemySecurityEventRepository",
    "SqlAlchemySessionRepository",
    "SqlAlchemySyncRepository",
    "SqlAlchemyUserRepository",
]
