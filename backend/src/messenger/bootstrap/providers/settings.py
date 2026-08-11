"""Validated configuration and immutable policy bindings."""

from datetime import timedelta

from dishka import Provider, Scope, provide

from messenger.application.accounts.password_reset_policy import PasswordResetPolicy
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.policy import SessionPolicy
from messenger.bootstrap.settings import AppSettings


class SettingsProvider(Provider):
    """Expose typed settings and derived policies in process scope."""

    def __init__(self, settings: AppSettings) -> None:
        super().__init__()
        self._settings = settings

    @provide(scope=Scope.APP)
    def settings(self) -> AppSettings:
        return self._settings

    @provide(scope=Scope.APP)
    def session_policy(self, settings: AppSettings) -> SessionPolicy:
        return settings.session_policy

    @provide(scope=Scope.APP)
    def security_event_policy(self, settings: AppSettings) -> SecurityEventPolicy:
        return settings.security_event_policy

    @provide(scope=Scope.APP)
    def activation_ttl(self, settings: AppSettings) -> timedelta:
        return settings.activation_token_ttl

    @provide(scope=Scope.APP)
    def password_reset_policy(self, settings: AppSettings) -> PasswordResetPolicy:
        return settings.password_reset_policy
