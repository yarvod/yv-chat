"""Current-account HTTP authorization and credential safety tests."""

from httpx import ASGITransport, AsyncClient

from tests.test_auth_http import PASSWORD, build_test_application, login

ORIGIN = "https://test"
NEW_PASSWORD = "new correct horse battery staple"
FORBIDDEN_FIELDS = {
    "password",
    "password_hash",
    "session_credential",
    "current_token_hash",
    "previous_token_hash",
    "activation_secret",
    "token_hash",
}


async def test_current_profile_password_change_and_security_reset_flow() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url=ORIGIN) as client:
        assert (await login(client)).status_code == 200
        current_login = await login(client)
        assert current_login.status_code == 200
        current_device_id = current_login.json()["device_id"]
        csrf = client.cookies["__Host-yv_csrf"]
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}

        current = await client.get("/api/v1/me")
        assert current.status_code == 200
        assert current.json()["username"] == "alice"
        assert current.json()["device_id"] == current_device_id
        assert FORBIDDEN_FIELDS.isdisjoint(current.json())

        missing_csrf = await client.patch(
            "/api/v1/me",
            headers={"Origin": ORIGIN},
            json={"display_name": "No CSRF"},
        )
        assert missing_csrf.status_code == 403

        updated = await client.patch(
            "/api/v1/me",
            headers=headers,
            json={"display_name": "  Alice Updated  "},
        )
        assert updated.status_code == 200
        assert updated.json()["display_name"] == "Alice Updated"
        assert updated.json()["device_id"] == current.json()["device_id"]

        wrong_password = await client.patch(
            "/api/v1/me/password",
            headers=headers,
            json={"current_password": "wrong", "new_password": NEW_PASSWORD},
        )
        assert wrong_password.status_code == 401
        assert all(session.revoked_at is None for session in state.sessions.values())

        changed = await client.patch(
            "/api/v1/me/password",
            headers=headers,
            json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert changed.status_code == 200
        assert changed.json()["revoked_sessions"] == 1
        assert sum(session.revoked_at is None for session in state.sessions.values()) == 1

        reset = await client.post(
            "/api/v1/me/security-reset",
            headers=headers,
            json={"current_password": NEW_PASSWORD},
        )
        assert reset.status_code == 204
        assert all(session.revoked_at is not None for session in state.sessions.values())
        assert "__Host-yv_session" not in client.cookies
        assert (await client.get("/api/v1/me")).status_code == 401


async def test_current_account_openapi_does_not_publish_secret_output_fields() -> None:
    application, _, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url=ORIGIN) as client:
        schemas = (await client.get("/openapi.json")).json()["components"]["schemas"]

    properties = schemas["CurrentAccountResponse"]["properties"]
    assert FORBIDDEN_FIELDS.isdisjoint(properties)
    assert "device_id" in properties
