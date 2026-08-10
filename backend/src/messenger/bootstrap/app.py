"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dishka import AsyncContainer
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from messenger.bootstrap.container import create_container
from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.auth import router as auth_router
from messenger.presentation.http.devices import router as devices_router
from messenger.presentation.http.health import router as health_router


def create_app(
    settings: AppSettings | None = None,
    *,
    container: AsyncContainer | None = None,
) -> FastAPI:
    """Create and configure the HTTP application."""
    resolved_settings = settings or AppSettings()
    resolved_container = container or create_container(resolved_settings)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await application.state.dishka_container.close()

    docs_url = "/docs" if resolved_settings.expose_api_schema else None
    openapi_url = "/openapi.json" if resolved_settings.expose_api_schema else None

    application = FastAPI(
        title="yv-chat API",
        version="0.1.0",
        docs_url=docs_url,
        redoc_url=None,
        openapi_url=openapi_url,
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=[resolved_settings.csrf_header_name, "Content-Type"],
    )
    application.include_router(health_router)
    application.include_router(auth_router)
    application.include_router(devices_router)
    setup_dishka(container=resolved_container, app=application)
    return application
