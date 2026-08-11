"""Opaque-session use-case bindings."""

from dishka import Provider, Scope, provide

from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.application.sessions.login import Login
from messenger.application.sessions.logout import Logout


class SessionUseCaseProvider(Provider):
    """Create session application operations in request scope."""

    login = provide(Login, scope=Scope.REQUEST)
    authenticate_session = provide(AuthenticateSession, scope=Scope.REQUEST)
    logout = provide(Logout, scope=Scope.REQUEST)
