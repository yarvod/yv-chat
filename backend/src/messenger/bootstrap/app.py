"""FastAPI application factory."""

from fastapi import FastAPI

from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.health import router as health_router


def create_app(settings: AppSettings | None = None) -> FastAPI:
    """Create and configure the HTTP application."""
    resolved_settings = settings or AppSettings()
    docs_url = "/docs" if resolved_settings.expose_api_schema else None
    openapi_url = "/openapi.json" if resolved_settings.expose_api_schema else None

    application = FastAPI(
        title="yv-chat API",
        version="0.1.0",
        docs_url=docs_url,
        redoc_url=None,
        openapi_url=openapi_url,
    )
    application.include_router(health_router)
    return application
