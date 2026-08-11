"""Opaque message HTTP envelope and authorization tests."""

import base64

from httpx import ASGITransport, AsyncClient

from messenger.domain.entities import User
from tests.test_auth_http import NOW, PASSWORD, build_test_application

ORIGIN = "https://test"


async def login_as(client: AsyncClient, username: str) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        headers={"Origin": ORIGIN},
        json={"username": username, "password": PASSWORD, "device_name": "Browser"},
    )
    assert response.status_code == 200


async def test_send_opaque_message_and_reject_invalid_or_non_member_envelopes() -> None:
    application, state, _ = build_test_application()
    alice = next(user for user in state.users.values() if user.username == "alice")
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    charlie = User.create(username="charlie", display_name="Charlie", now=NOW)
    for user in (bob, charlie):
        state.users[user.id] = user
        state.password_hashes[user.id] = "$argon2id$fake-hash"
    transport = ASGITransport(app=application)

    async with (
        AsyncClient(transport=transport, base_url=ORIGIN) as alice_client,
        AsyncClient(transport=transport, base_url=ORIGIN) as charlie_client,
    ):
        await login_as(alice_client, "alice")
        await login_as(charlie_client, "charlie")
        alice_headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": alice_client.cookies["__Host-yv_csrf"],
        }
        charlie_headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": charlie_client.cookies["__Host-yv_csrf"],
        }
        direct = await alice_client.post(
            "/api/v1/conversations/direct",
            headers=alice_headers,
            json={"other_user_id": str(bob.id)},
        )
        conversation_id = direct.json()["conversation_id"]
        ciphertext = b"\x00\xffsynthetic-opaque-envelope"

        sent = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json={
                "protocol_version": 1,
                "ciphertext_base64": base64.b64encode(ciphertext).decode(),
            },
        )
        assert sent.status_code == 201
        assert "ciphertext" not in sent.json()
        stored = state.messages[next(iter(state.messages))]
        assert stored.ciphertext == ciphertext
        assert stored.sender_user_id == alice.id

        invalid_base64 = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json={"protocol_version": 1, "ciphertext_base64": "***"},
        )
        unsupported = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json={"protocol_version": 2, "ciphertext_base64": "b3BhcXVl"},
        )
        non_member = await charlie_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=charlie_headers,
            json={"protocol_version": 1, "ciphertext_base64": "b3BhcXVl"},
        )
        assert invalid_base64.status_code == 422
        assert unsupported.status_code == 422
        assert non_member.status_code == 404
        assert len(state.messages) == 1


async def test_message_openapi_response_has_no_content_or_key_fields() -> None:
    application, _, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url=ORIGIN) as client:
        schemas = (await client.get("/openapi.json")).json()["components"]["schemas"]

    response_fields = schemas["SendOpaqueMessageResponse"]["properties"]
    assert {"ciphertext", "ciphertext_base64", "plaintext", "text", "message_key"}.isdisjoint(
        response_fields
    )
