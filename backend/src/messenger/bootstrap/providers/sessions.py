"""Opaque-session use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.application.sessions.login import Login
from messenger.application.sessions.logout import Logout
from messenger.application.sessions.validate_active import ValidateActiveSession


class SessionUseCaseProvider(Provider):
    """Create session application operations in request scope."""

    login = provide(Login, scope=Scope.REQUEST)
    authenticate_session = provide(AuthenticateSession, scope=Scope.REQUEST)
    validate_active_session = provide(ValidateActiveSession, scope=Scope.REQUEST)
    logout = provide(Logout, scope=Scope.REQUEST)
