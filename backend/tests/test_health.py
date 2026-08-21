"""Health endpoint tests."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from pydantic import ValidationError

from messenger.bootstrap.app import create_app
from messenger.bootstrap.settings import AppEnvironment, AppSettings

TEST_DATABASE_URL = "postgresql+asyncpg://test:test@127.0.0.1:5432/test"


async def get(application: FastAPI, path: str) -> Response:
    """Issue a request directly against the ASGI application."""
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def test_health_endpoint_reports_ok() -> None:
    settings = AppSettings(database_url=TEST_DATABASE_URL)
    response = await get(create_app(settings), "/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_production_does_not_expose_openapi() -> None:
    settings = AppSettings(
        app_env=AppEnvironment.PRODUCTION,
        database_url=TEST_DATABASE_URL,
        allowed_origins=["https://chat.example"],
    )
    application = create_app(settings)

    assert (await get(application, "/docs")).status_code == 404
    assert (await get(application, "/openapi.json")).status_code == 404


def test_production_accepts_exact_capacitor_origin_without_wildcard() -> None:
    settings = AppSettings(
        app_env=AppEnvironment.PRODUCTION,
        database_url=TEST_DATABASE_URL,
        allowed_origins=[
            "https://chat.example",
            "capacitor://app.yvchat.local",
            "https://app.yvchat.local",
        ],
    )

    assert settings.allowed_origins == [
        "https://chat.example",
        "capacitor://app.yvchat.local",
        "https://app.yvchat.local",
    ]
    with pytest.raises(ValidationError):
        AppSettings(
            app_env=AppEnvironment.PRODUCTION,
            database_url=TEST_DATABASE_URL,
            allowed_origins=["capacitor://*"],
        )
