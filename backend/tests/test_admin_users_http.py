"""Closed administrator user lifecycle HTTP security tests."""

from uuid import UUID

from httpx import ASGITransport, AsyncClient

from tests.test_auth_http import PASSWORD, build_test_application, login

ORIGIN = "https://test"
FORBIDDEN_FIELDS = {
    "activation_secret_hash",
    "current_token_hash",
    "password_hash",
    "previous_token_hash",
    "session_credential",
    "token_hash",
}


async def test_admin_invite_reissue_activate_deactivate_and_reactivate_flow() -> None:
    application, state, _ = build_test_application(is_admin=True)
    transport = ASGITransport(app=application)

    async with (
        AsyncClient(transport=transport, base_url=ORIGIN) as admin_client,
        AsyncClient(transport=transport, base_url=ORIGIN) as member_client,
    ):
        admin_login = await login(admin_client)
        assert admin_login.status_code == 200
        admin_id = UUID(admin_login.json()["user_id"])
        csrf = admin_client.cookies["__Host-yv_csrf"]
        write_headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}

        missing_csrf = await admin_client.post(
            "/api/v1/admin/users",
            headers={"Origin": ORIGIN},
            json={"username": "bob", "display_name": "Bob"},
        )
        assert missing_csrf.status_code == 403

        invited = await admin_client.post(
            "/api/v1/admin/users",
            headers=write_headers,
            json={"username": "bob", "display_name": "Bob"},
        )
        assert invited.status_code == 201
        invited_body = invited.json()
        bob_id = UUID(invited_body["user_id"])
        first_secret = invited_body["activation_secret"]
        assert first_secret
        assert all(first_secret != token.token_hash for token in state.tokens.values())

        duplicate = await admin_client.post(
            "/api/v1/admin/users",
            headers=write_headers,
            json={"username": "BOB", "display_name": "Duplicate"},
        )
        assert duplicate.status_code == 409

        users = await admin_client.get("/api/v1/admin/users")
        assert users.status_code == 200
        assert users.json()["total"] == 2
        bob_item = next(item for item in users.json()["items"] if item["user_id"] == str(bob_id))
        assert bob_item["activation_pending"] is True
        assert bob_item["active_sessions"] == 0
        assert all(FORBIDDEN_FIELDS.isdisjoint(item) for item in users.json()["items"])

        searched = await admin_client.get("/api/v1/admin/users?search=BO&limit=1&offset=0")
        assert searched.status_code == 200
        assert searched.json()["total"] == 1
        assert [item["username"] for item in searched.json()["items"]] == ["bob"]

        cannot_bypass_activation = await admin_client.patch(
            f"/api/v1/admin/users/{bob_id}",
            headers=write_headers,
            json={"is_active": True},
        )
        assert cannot_bypass_activation.status_code == 409

        reissued = await admin_client.post(
            f"/api/v1/admin/users/{bob_id}/activation-secret",
            headers=write_headers,
        )
        assert reissued.status_code == 200
        second_secret = reissued.json()["activation_secret"]
        assert second_secret != first_secret
        assert any(token.revoked_at is not None for token in state.tokens.values())

        missing_origin = await member_client.post(
            "/api/v1/auth/activate",
            json={"activation_secret": second_secret, "password": PASSWORD},
        )
        assert missing_origin.status_code == 403

        old_activation = await member_client.post(
            "/api/v1/auth/activate",
            headers={"Origin": ORIGIN},
            json={"activation_secret": first_secret, "password": PASSWORD},
        )
        assert old_activation.status_code == 400
        assert old_activation.json() == {"detail": "activation failed"}

        activated = await member_client.post(
            "/api/v1/auth/activate",
            headers={"Origin": ORIGIN},
            json={"activation_secret": second_secret, "password": PASSWORD},
        )
        assert activated.status_code == 200
        assert activated.json()["user_id"] == str(bob_id)
        assert "password" not in activated.json()

        bob_login = await member_client.post(
            "/api/v1/auth/login",
            headers={"Origin": ORIGIN},
            json={"username": "bob", "password": PASSWORD, "device_name": "Bob phone"},
        )
        assert bob_login.status_code == 200

        normal_user_forbidden = await member_client.get("/api/v1/admin/users")
        assert normal_user_forbidden.status_code == 403

        deactivated = await admin_client.patch(
            f"/api/v1/admin/users/{bob_id}",
            headers=write_headers,
            json={"display_name": "Bobby", "is_active": False},
        )
        assert deactivated.status_code == 200
        assert deactivated.json()["revoked_sessions"] == 1
        assert deactivated.json()["can_reactivate"] is True

        revoked_session = await member_client.get("/api/v1/auth/session")
        assert revoked_session.status_code == 401

        reactivated = await admin_client.patch(
            f"/api/v1/admin/users/{bob_id}",
            headers=write_headers,
            json={"is_active": True},
        )
        assert reactivated.status_code == 200
        assert reactivated.json()["is_active"] is True

        reset_missing_csrf = await admin_client.post(
            f"/api/v1/admin/users/{bob_id}/password-reset",
            headers={"Origin": ORIGIN},
        )
        assert reset_missing_csrf.status_code == 403

        bob_login_again = await member_client.post(
            "/api/v1/auth/login",
            headers={"Origin": ORIGIN},
            json={"username": "bob", "password": PASSWORD, "device_name": "Bob laptop"},
        )
        assert bob_login_again.status_code == 200

        reset_issued = await admin_client.post(
            f"/api/v1/admin/users/{bob_id}/password-reset",
            headers=write_headers,
        )
        assert reset_issued.status_code == 200
        reset_secret = reset_issued.json()["reset_secret"]
        assert reset_issued.json()["revoked_sessions"] == 1
        assert all(
            reset_secret != token.token_hash for token in state.password_reset_tokens.values()
        )
        assert (await member_client.get("/api/v1/auth/session")).status_code == 401

        activation_is_not_reset = await member_client.post(
            "/api/v1/auth/reset-password",
            headers={"Origin": ORIGIN},
            json={"reset_secret": second_secret, "new_password": "new safe password for bob"},
        )
        assert activation_is_not_reset.status_code == 400
        assert activation_is_not_reset.json() == {"detail": "password reset failed"}

        reset_without_origin = await member_client.post(
            "/api/v1/auth/reset-password",
            json={"reset_secret": reset_secret, "new_password": "new safe password for bob"},
        )
        assert reset_without_origin.status_code == 403

        password_reset = await member_client.post(
            "/api/v1/auth/reset-password",
            headers={"Origin": ORIGIN},
            json={"reset_secret": reset_secret, "new_password": "new safe password for bob"},
        )
        assert password_reset.status_code == 200
        assert password_reset.json()["user_id"] == str(bob_id)
        assert "reset_secret" not in password_reset.json()

        reset_replay = await member_client.post(
            "/api/v1/auth/reset-password",
            headers={"Origin": ORIGIN},
            json={"reset_secret": reset_secret, "new_password": "another safe password for bob"},
        )
        assert reset_replay.status_code == 400
        assert reset_replay.json() == {"detail": "password reset failed"}

        old_password_login = await member_client.post(
            "/api/v1/auth/login",
            headers={"Origin": ORIGIN},
            json={"username": "bob", "password": PASSWORD, "device_name": "Old secret"},
        )
        assert old_password_login.status_code == 401
        new_password_login = await member_client.post(
            "/api/v1/auth/login",
            headers={"Origin": ORIGIN},
            json={
                "username": "bob",
                "password": "new safe password for bob",
                "device_name": "Recovered browser",
            },
        )
        assert new_password_login.status_code == 200

        self_deactivate = await admin_client.patch(
            f"/api/v1/admin/users/{admin_id}",
            headers=write_headers,
            json={"is_active": False},
        )
        assert self_deactivate.status_code == 409

        self_reset = await admin_client.post(
            f"/api/v1/admin/users/{admin_id}/password-reset",
            headers=write_headers,
        )
        assert self_reset.status_code == 409


async def test_admin_openapi_does_not_publish_secret_hash_fields() -> None:
    application, _, _ = build_test_application(is_admin=True)
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url=ORIGIN) as client:
        openapi = (await client.get("/openapi.json")).json()

    schemas = openapi["components"]["schemas"]
    response_schema_names = {
        "ManagedUserResponse",
        "ManagedUsersPageResponse",
        "InvitationResponse",
        "ReissueActivationResponse",
        "ActivateAccountResponse",
        "PasswordResetResponse",
        "ResetPasswordResponse",
    }
    for name in response_schema_names:
        properties = schemas[name]["properties"]
        assert FORBIDDEN_FIELDS.isdisjoint(properties)
