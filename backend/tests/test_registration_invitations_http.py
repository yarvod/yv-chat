"""Standalone registration invitation HTTP security flow."""

from httpx import ASGITransport, AsyncClient

from tests.test_auth_http import PASSWORD, build_test_application, login

ORIGIN = "https://test"


async def test_admin_manages_invitation_and_registration_auto_logs_in() -> None:
    application, state, _ = build_test_application(is_admin=True)
    transport = ASGITransport(app=application)
    async with (
        AsyncClient(transport=transport, base_url=ORIGIN) as admin_client,
        AsyncClient(transport=transport, base_url=ORIGIN) as invited_client,
    ):
        assert (await login(admin_client)).status_code == 200
        csrf = admin_client.cookies["__Host-yv_csrf"]
        headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}

        assert (
            await admin_client.post(
                "/api/v1/admin/invitations",
                headers={"Origin": ORIGIN},
                json={"label": "Для Боба"},
            )
        ).status_code == 403
        created = await admin_client.post(
            "/api/v1/admin/invitations",
            headers=headers,
            json={"label": "Для Боба"},
        )
        assert created.status_code == 201
        secret = created.json()["activation_secret"]
        invitation_id = created.json()["invitation_id"]
        assert secret
        assert len(state.users) == 1

        listed = await admin_client.get("/api/v1/admin/invitations")
        assert listed.status_code == 200
        assert listed.json()["items"][0]["status"] == "active"
        assert "activation_secret" not in listed.text
        assert "token_hash" not in listed.text
        assert secret not in listed.text

        payload = {
            "activation_secret": secret,
            "username": "bob",
            "display_name": "Bob",
            "password": PASSWORD,
            "device_name": "Bob phone",
        }
        assert (await invited_client.post("/api/v1/auth/register", json=payload)).status_code == 403
        registered = await invited_client.post(
            "/api/v1/auth/register",
            headers={"Origin": ORIGIN},
            json=payload,
        )
        assert registered.status_code == 200
        assert invited_client.cookies.get("__Host-yv_session")
        assert invited_client.cookies.get("__Host-yv_csrf")
        assert (await invited_client.get("/api/v1/me")).status_code == 200

        used = await admin_client.get("/api/v1/admin/invitations")
        item = next(row for row in used.json()["items"] if row["invitation_id"] == invitation_id)
        assert item["status"] == "used"
        assert item["registered_username"] == "bob"
        assert (
            await admin_client.post(
                f"/api/v1/admin/invitations/{invitation_id}/revoke",
                headers=headers,
            )
        ).status_code == 409


async def test_username_conflict_preserves_invite_and_revocation_stops_open_form() -> None:
    application, _, _ = build_test_application(is_admin=True)
    transport = ASGITransport(app=application)
    async with (
        AsyncClient(transport=transport, base_url=ORIGIN) as admin_client,
        AsyncClient(transport=transport, base_url=ORIGIN) as invited_client,
    ):
        assert (await login(admin_client)).status_code == 200
        headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": admin_client.cookies["__Host-yv_csrf"],
        }
        created = await admin_client.post(
            "/api/v1/admin/invitations",
            headers=headers,
            json={},
        )
        secret = created.json()["activation_secret"]
        invitation_id = created.json()["invitation_id"]
        request = {
            "activation_secret": secret,
            "username": "alice",
            "display_name": "Other Alice",
            "password": PASSWORD,
            "device_name": "Phone",
        }
        conflict = await invited_client.post(
            "/api/v1/auth/register",
            headers={"Origin": ORIGIN},
            json=request,
        )
        assert conflict.status_code == 409
        assert (
            await admin_client.post(
                f"/api/v1/admin/invitations/{invitation_id}/revoke",
                headers=headers,
            )
        ).status_code == 200
        request["username"] = "available"
        revoked = await invited_client.post(
            "/api/v1/auth/register",
            headers={"Origin": ORIGIN},
            json=request,
        )
        assert revoked.status_code == 400
        assert revoked.json() == {"detail": "registration failed"}


async def test_normal_user_cannot_manage_registration_invitations() -> None:
    application, _, _ = build_test_application(is_admin=False)
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url=ORIGIN) as client:
        assert (await login(client)).status_code == 200
        headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": client.cookies["__Host-yv_csrf"],
        }
        assert (await client.get("/api/v1/admin/invitations")).status_code == 403
        assert (
            await client.post("/api/v1/admin/invitations", headers=headers, json={})
        ).status_code == 403
