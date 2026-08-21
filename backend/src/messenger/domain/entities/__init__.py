"""Domain entities."""

from messenger.domain.entities.activation_token import ActivationToken
from messenger.domain.entities.attachment import Attachment, AttachmentMediaKind
from messenger.domain.entities.conversation import (
    Conversation,
    ConversationMember,
    ConversationMemberRole,
    ConversationType,
)
from messenger.domain.entities.conversation_crypto import (
    ConversationCryptoBlockReason,
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    ConversationCryptoStatus,
    ConversationCryptoWelcome,
)
from messenger.domain.entities.conversation_delivery_state import ConversationDeliveryState
from messenger.domain.entities.conversation_read_state import ConversationReadState
from messenger.domain.entities.device import Device
from messenger.domain.entities.device_crypto_identity import (
    DeviceCryptoIdentity,
    DeviceKeyPackage,
)
from messenger.domain.entities.device_history_chunk import DeviceHistoryChunk
from messenger.domain.entities.device_pairing import (
    DevicePairing,
    DevicePairingPurpose,
    DevicePairingStatus,
)
from messenger.domain.entities.message import Message, MessageDeletionReason
from messenger.domain.entities.message_pin import MessagePin
from messenger.domain.entities.message_reaction import (
    ALLOWED_MESSAGE_REACTIONS,
    MessageReaction,
)
from messenger.domain.entities.password_reset_token import PasswordResetToken
from messenger.domain.entities.push_subscription import PushProvider, PushSubscription
from messenger.domain.entities.registration_invitation import RegistrationInvitation
from messenger.domain.entities.security_event import SecurityEvent, SecurityEventType
from messenger.domain.entities.session import Session
from messenger.domain.entities.user import User

__all__ = [
    "ActivationToken",
    "Attachment",
    "AttachmentMediaKind",
    "Conversation",
    "ConversationCryptoBlockReason",
    "ConversationCryptoGeneration",
    "ConversationCryptoRequiredDevice",
    "ConversationCryptoStatus",
    "ConversationCryptoWelcome",
    "ConversationMember",
    "ConversationMemberRole",
    "ConversationType",
    "ConversationReadState",
    "ConversationDeliveryState",
    "Message",
    "MessageDeletionReason",
    "MessagePin",
    "MessageReaction",
    "ALLOWED_MESSAGE_REACTIONS",
    "PasswordResetToken",
    "PushSubscription",
    "PushProvider",
    "RegistrationInvitation",
    "Device",
    "DevicePairing",
    "DevicePairingPurpose",
    "DevicePairingStatus",
    "DeviceHistoryChunk",
    "DeviceCryptoIdentity",
    "DeviceKeyPackage",
    "SecurityEvent",
    "SecurityEventType",
    "Session",
    "User",
]
