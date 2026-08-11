"""Typed errors exposed by identity use cases."""


class ApplicationError(Exception):
    """Base for expected application-level failures."""


class AuthorizationDeniedError(ApplicationError):
    """The current principal cannot perform the requested operation."""


class DuplicateUsernameError(ApplicationError):
    """A normalized username is already in use."""


class InvalidActivationSecretError(ApplicationError):
    """The supplied activation credential is unknown."""


class ActivationExpiredError(ApplicationError):
    """The supplied activation credential has expired."""


class ActivationAlreadyUsedError(ApplicationError):
    """The supplied activation credential was already consumed."""


class AccountAlreadyActiveError(ApplicationError):
    """The invited account has already been activated."""


class WeakPasswordError(ApplicationError):
    """The supplied password violates the bounded password policy."""


class BootstrapAlreadyCompletedError(ApplicationError):
    """At least one user exists, so initial admin bootstrap is closed."""


class InvalidCredentialsError(ApplicationError):
    """Login failed without disclosing which credential was incorrect."""


class SessionNotAuthenticatedError(ApplicationError):
    """The presented session cannot authenticate a request."""


class SessionCredentialReplayError(SessionNotAuthenticatedError):
    """An expired previous credential was replayed and the session was revoked."""


class OwnedDeviceNotFoundError(ApplicationError):
    """The requested device is absent or owned by another user."""


class CurrentDeviceRevocationError(ApplicationError):
    """The current device must be terminated through logout, not remote revoke."""


class ManagedUserNotFoundError(ApplicationError):
    """The requested managed user does not exist."""


class SelfDeactivationError(ApplicationError):
    """An administrator cannot deactivate the current account through admin API."""


class AccountActivationRequiredError(ApplicationError):
    """An invited account must complete activation before it can become active."""


class InvalidPasswordResetSecretError(ApplicationError):
    """A reset credential is unknown, expired, consumed or revoked."""


class SelfPasswordResetError(ApplicationError):
    """An admin must use the authenticated step-up flow for its own password."""


class DuplicateDirectConversationError(ApplicationError):
    """A direct conversation already exists for the unordered user pair."""


class InvalidStepUpCredentialsError(ApplicationError):
    """Sensitive current-account confirmation failed without extra disclosure."""


class ConversationNotFoundError(ApplicationError):
    """A conversation is absent or inaccessible to the current actor."""


class ConversationParticipantNotFoundError(ApplicationError):
    """A requested active participant account does not exist."""


class ConversationMembershipConflictError(ApplicationError):
    """A requested membership transition conflicts with current state."""


class InvalidMessageEnvelopeError(ApplicationError):
    """An opaque message envelope violates supported version or size bounds."""


class MessageIdempotencyConflictError(ApplicationError):
    """A client message ID was reused for different immutable envelope data."""


class RealtimeSubscriptionClosedError(ApplicationError):
    """A realtime connection was removed because its bounded inbox closed."""


class InvalidReadSequenceError(ApplicationError):
    """A read cursor does not identify an existing authorized message."""


class InvalidDeliverySequenceError(ApplicationError):
    """A delivery cursor does not identify an existing authorized message."""
