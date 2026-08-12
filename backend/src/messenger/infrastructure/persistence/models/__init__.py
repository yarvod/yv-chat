"""SQLAlchemy persistence models and metadata."""

from messenger.infrastructure.persistence.models.activation_token import ActivationTokenModel
from messenger.infrastructure.persistence.models.attachment import AttachmentModel
from messenger.infrastructure.persistence.models.base import Base
from messenger.infrastructure.persistence.models.conversation import (
    ConversationMemberModel,
    ConversationModel,
)
from messenger.infrastructure.persistence.models.conversation_crypto import (
    ConversationCryptoGenerationModel,
    ConversationCryptoRequiredDeviceModel,
    ConversationCryptoWelcomeModel,
)
from messenger.infrastructure.persistence.models.conversation_delivery_state import (
    ConversationDeliveryStateModel,
)
from messenger.infrastructure.persistence.models.conversation_read_state import (
    ConversationReadStateModel,
)
from messenger.infrastructure.persistence.models.device import DeviceModel
from messenger.infrastructure.persistence.models.device_crypto_identity import (
    DeviceCryptoIdentityModel,
    DeviceKeyPackageModel,
)
from messenger.infrastructure.persistence.models.message import MessageModel
from messenger.infrastructure.persistence.models.password_reset_token import PasswordResetTokenModel
from messenger.infrastructure.persistence.models.push_subscription import PushSubscriptionModel
from messenger.infrastructure.persistence.models.security_event import SecurityEventModel
from messenger.infrastructure.persistence.models.session import SessionModel
from messenger.infrastructure.persistence.models.sync import SyncEventModel, SyncStreamModel
from messenger.infrastructure.persistence.models.user import UserModel

__all__ = [
    "ActivationTokenModel",
    "AttachmentModel",
    "Base",
    "ConversationMemberModel",
    "ConversationModel",
    "ConversationCryptoGenerationModel",
    "ConversationCryptoRequiredDeviceModel",
    "ConversationCryptoWelcomeModel",
    "ConversationDeliveryStateModel",
    "ConversationReadStateModel",
    "DeviceModel",
    "DeviceCryptoIdentityModel",
    "DeviceKeyPackageModel",
    "MessageModel",
    "PasswordResetTokenModel",
    "PushSubscriptionModel",
    "SecurityEventModel",
    "SessionModel",
    "SyncEventModel",
    "SyncStreamModel",
    "UserModel",
]
