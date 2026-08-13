"""Identity persistence ports, split by aggregate and re-exported as one boundary."""

from messenger.application.ports.identity.activation_tokens import ActivationTokenRepository
from messenger.application.ports.identity.devices import DeviceRepository
from messenger.application.ports.identity.password_reset_tokens import PasswordResetTokenRepository
from messenger.application.ports.identity.records import (
    DeviceSessionRecord,
    ManagedUserPageRecord,
    ManagedUserRecord,
    SessionCredentialMatch,
    UserAuthenticationRecord,
)
from messenger.application.ports.identity.registration_invitations import (
    RegistrationInvitationRepository,
)
from messenger.application.ports.identity.security_events import SecurityEventRepository
from messenger.application.ports.identity.sessions import SessionRepository
from messenger.application.ports.identity.unit_of_work import (
    IdentityUnitOfWork,
    IdentityUnitOfWorkFactory,
)
from messenger.application.ports.identity.users import UserRepository

__all__ = [
    "ActivationTokenRepository",
    "DeviceRepository",
    "DeviceSessionRecord",
    "IdentityUnitOfWork",
    "IdentityUnitOfWorkFactory",
    "ManagedUserRecord",
    "ManagedUserPageRecord",
    "PasswordResetTokenRepository",
    "RegistrationInvitationRepository",
    "SecurityEventRepository",
    "SessionCredentialMatch",
    "SessionRepository",
    "UserAuthenticationRecord",
    "UserRepository",
]
