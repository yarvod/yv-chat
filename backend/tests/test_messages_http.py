"""Opaque message HTTP envelope and authorization tests."""

import base64
from uuid import uuid4

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
        client_message_id = uuid4()

        envelope = {
            "protocol_version": 1,
            "client_message_id": str(client_message_id),
            "ciphertext_base64": base64.b64encode(ciphertext).decode(),
        }
        sent = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json=envelope,
        )
        assert sent.status_code == 201
        assert "ciphertext" not in sent.json()
        stored = state.messages[next(iter(state.messages))]
        assert stored.ciphertext == ciphertext
        assert stored.sender_user_id == alice.id
        retried = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json=envelope,
        )
        assert retried.status_code == 201
        assert retried.json()["message_id"] == sent.json()["message_id"]
        assert len(state.messages) == 1
        conflict = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json={**envelope, "ciphertext_base64": "ZGlmZmVyZW50"},
        )
        assert conflict.status_code == 409

        sync = await alice_client.get("/api/v1/sync?after=0&limit=10")
        assert sync.status_code == 200
        assert [event["event_type"] for event in sync.json()["events"]] == [
            "conversation_updated",
            "message_created",
            "read_receipt",
            "delivery_receipt",
        ]
        assert sync.json()["events"][-3]["message_id"] == sent.json()["message_id"]
        assert sync.json()["events"][-1]["actor_user_id"] == str(alice.id)
        assert sync.json()["events"][-2]["read_sequence"] == 1
        assert sync.json()["events"][-1]["delivery_sequence"] == 1

        page = await alice_client.get(
            f"/api/v1/conversations/{conversation_id}/messages?after_sequence=0&limit=10"
        )
        assert page.status_code == 200
        assert [item["sequence"] for item in page.json()] == [1]
        assert base64.b64decode(page.json()[0]["ciphertext_base64"]) == ciphertext

        invalid_base64 = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json={
                "client_message_id": str(uuid4()),
                "protocol_version": 1,
                "ciphertext_base64": "***",
            },
        )
        unsupported = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json={
                "client_message_id": str(uuid4()),
                "protocol_version": 2,
                "ciphertext_base64": "b3BhcXVl",
            },
        )
        non_member = await charlie_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=charlie_headers,
            json={
                "client_message_id": str(uuid4()),
                "protocol_version": 1,
                "ciphertext_base64": "b3BhcXVl",
            },
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


async def test_delete_for_everyone_requires_csrf_and_returns_tombstone() -> None:
    application, state, _ = build_test_application()
    bob = User.create(username="bob", display_name="Bob", now=NOW)
    state.users[bob.id] = bob
    state.password_hashes[bob.id] = "$argon2id$fake-hash"
    transport = ASGITransport(app=application)
    async with (
        AsyncClient(transport=transport, base_url=ORIGIN) as alice_client,
        AsyncClient(transport=transport, base_url=ORIGIN) as bob_client,
    ):
        await login_as(alice_client, "alice")
        await login_as(bob_client, "bob")
        alice_headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": alice_client.cookies["__Host-yv_csrf"],
        }
        bob_headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": bob_client.cookies["__Host-yv_csrf"],
        }
        direct = await alice_client.post(
            "/api/v1/conversations/direct",
            headers=alice_headers,
            json={"other_user_id": str(bob.id)},
        )
        conversation_id = direct.json()["conversation_id"]
        sent = await alice_client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=alice_headers,
            json={
                "protocol_version": 1,
                "client_message_id": str(uuid4()),
                "ciphertext_base64": "b3BhcXVl",
            },
        )
        message_id = sent.json()["message_id"]

        missing_csrf = await alice_client.delete(
            f"/api/v1/conversations/{conversation_id}/messages/{message_id}",
            headers={"Origin": ORIGIN},
        )
        peer_forbidden = await bob_client.delete(
            f"/api/v1/conversations/{conversation_id}/messages/{message_id}",
            headers=bob_headers,
        )
        deleted = await alice_client.delete(
            f"/api/v1/conversations/{conversation_id}/messages/{message_id}",
            headers=alice_headers,
        )
        duplicate = await alice_client.delete(
            f"/api/v1/conversations/{conversation_id}/messages/{message_id}",
            headers=alice_headers,
        )

        assert missing_csrf.status_code == 403
        assert peer_forbidden.status_code == 403
        assert deleted.status_code == 200
        assert deleted.json()["advanced"] is True
        assert deleted.json()["deletion_reason"] == "manual"
        assert duplicate.status_code == 200
        assert duplicate.json()["advanced"] is False
        page = await alice_client.get(
            f"/api/v1/conversations/{conversation_id}/messages?after_sequence=0&limit=10"
        )
        assert page.json()[0]["ciphertext_base64"] is None
        assert page.json()[0]["deletion_reason"] == "manual"
        assert page.json()[0]["deleted_at"] is not None
        assert state.messages[next(iter(state.messages))].ciphertext is None

        sync = await bob_client.get("/api/v1/sync?after=0&limit=20")
        assert "message_deleted" in {event["event_type"] for event in sync.json()["events"]}
