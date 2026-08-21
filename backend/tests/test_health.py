"""Health endpoint tests."""

from base64 import b64encode

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from pydantic import SecretStr, ValidationError

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


def test_native_push_credentials_are_atomic_and_validated_as_secrets() -> None:
    with pytest.raises(ValidationError, match="APNs key ID"):
        AppSettings(
            database_url=TEST_DATABASE_URL,
            apns_key_id="ABCDEFGHIJ",
        )
    with pytest.raises(ValidationError, match="FCM project ID"):
        AppSettings(
            database_url=TEST_DATABASE_URL,
            fcm_project_id="yv-chat",
        )


def test_complete_native_push_credentials_enable_exact_providers() -> None:
    def encoded(key: ec.EllipticCurvePrivateKey | rsa.RSAPrivateKey) -> str:
        pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        return b64encode(pem).decode("ascii")

    settings = AppSettings(
        database_url=TEST_DATABASE_URL,
        apns_key_id="ABCDEFGHIJ",
        apns_team_id="KLMNOPQRST",
        apns_bundle_id="ru.yoowee.chat",
        apns_private_key_b64=SecretStr(encoded(ec.generate_private_key(ec.SECP256R1()))),
        fcm_project_id="yv-chat",
        fcm_client_email="push@yv-chat.iam.gserviceaccount.com",
        fcm_private_key_b64=SecretStr(encoded(rsa.generate_private_key(65537, 2048))),
    )

    assert settings.apns_enabled is True
    assert settings.fcm_enabled is True
    assert "BEGIN PRIVATE KEY" in settings.apns_private_key_value
    assert "BEGIN PRIVATE KEY" in settings.fcm_private_key_value
