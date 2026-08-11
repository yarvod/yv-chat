"""Create the Dishka container from small context-specific providers."""

from dishka import AsyncContainer, make_async_container
from dishka.integrations.fastapi import FastapiProvider

from messenger.bootstrap.providers import application_providers
from messenger.bootstrap.settings import AppSettings


def create_container(settings: AppSettings) -> AsyncContainer:
    """Build the process container; FastAPI opens and closes REQUEST scopes."""
    return make_async_container(
        *application_providers(settings),
        FastapiProvider(),
    )
