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


class DuplicateDirectConversationError(ApplicationError):
    """A direct conversation already exists for the unordered user pair."""
