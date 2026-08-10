"""Health endpoint tests."""

import asyncio

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from messenger.bootstrap.app import create_app
from messenger.bootstrap.settings import AppEnvironment, AppSettings


async def get(application: FastAPI, path: str) -> Response:
    """Issue a request directly against the ASGI application."""
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def test_health_endpoint_reports_ok() -> None:
    response = asyncio.run(get(create_app(), "/api/health"))

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_production_does_not_expose_openapi() -> None:
    settings = AppSettings(app_env=AppEnvironment.PRODUCTION)
    application = create_app(settings)

    assert asyncio.run(get(application, "/docs")).status_code == 404
    assert asyncio.run(get(application, "/openapi.json")).status_code == 404
