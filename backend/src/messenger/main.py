"""ASGI application entry point."""

from messenger.bootstrap.app import create_app

app = create_app()
