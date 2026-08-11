"""Security and time adapter bindings."""

from dishka import Provider, Scope, provide

from messenger.application.ports.activation_secrets import ActivationSecretService
from messenger.application.ports.clock import Clock
from messenger.application.ports.passwords import PasswordHasher
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.infrastructure.auth.activation_secrets import SecureActivationSecretService
from messenger.infrastructure.auth.passwords import Argon2PasswordHasher
from messenger.infrastructure.auth.session_credentials import SecureSessionCredentialService
from messenger.infrastructure.clock import SystemClock


class SecurityAdapterProvider(Provider):
    """Bind application security ports to concrete audited adapters."""

    @provide(scope=Scope.APP)
    def clock(self) -> Clock:
        return SystemClock()

    @provide(scope=Scope.APP)
    def passwords(self) -> PasswordHasher:
        return Argon2PasswordHasher()

    @provide(scope=Scope.APP)
    def activation_secrets(self) -> ActivationSecretService:
        return SecureActivationSecretService()

    @provide(scope=Scope.APP)
    def session_credentials(self) -> SessionCredentialService:
        return SecureSessionCredentialService()
