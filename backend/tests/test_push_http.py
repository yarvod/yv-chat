"""Public Web Push configuration redaction."""

from base64 import urlsafe_b64encode

from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from messenger.bootstrap.app import create_app
from messenger.bootstrap.settings import AppEnvironment, AppSettings

PUBLIC_KEY = urlsafe_b64encode(b"\x04" + b"v" * 64).decode().rstrip("=")
PRIVATE_KEY = urlsafe_b64encode(b"k" * 32).decode().rstrip("=")


async def test_push_config_exposes_only_public_application_server_key() -> None:
    settings = AppSettings(
        app_env=AppEnvironment.TEST,
        database_url="postgresql+asyncpg://test:test@127.0.0.1:5432/test",
        allowed_origins=["https://chat.example.test"],
        vapid_public_key=PUBLIC_KEY,
        vapid_private_key=SecretStr(PRIVATE_KEY),
        vapid_contact="mailto:admin@example.test",
    )
    application = create_app(settings)
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://chat.example.test",
    ) as client:
        response = await client.get("/api/v1/push/config")

    assert response.status_code == 200
    assert response.json() == {
        "enabled": True,
        "application_server_key": PUBLIC_KEY,
        "providers": ["web"],
    }
    assert PRIVATE_KEY not in response.text
    await application.state.dishka_container.close()
