"""Conversation HTTP membership and authorization tests."""

from uuid import UUID, uuid4

from httpx import ASGITransport, AsyncClient

from messenger.domain.entities import User
from tests.test_auth_http import NOW, PASSWORD, build_test_application

ORIGIN = "https://test"
FORBIDDEN_FIELDS = {
    "password_hash",
    "session_credential",
    "current_token_hash",
    "previous_token_hash",
    "token_hash",
    "plaintext",
    "message_key",
}


async def login_as(client: AsyncClient, username: str) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        headers={"Origin": ORIGIN},
        json={
            "username": username,
            "password": PASSWORD,
            "device_name": f"{username} browser",
        },
    )
    assert response.status_code == 200


async def test_conversation_membership_http_flow_and_negative_authorization() -> None:
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
        AsyncClient(transport=transport, base_url=ORIGIN) as bob_client,
        AsyncClient(transport=transport, base_url=ORIGIN) as charlie_client,
    ):
        await login_as(alice_client, "alice")
        await login_as(bob_client, "bob")
        await login_as(charlie_client, "charlie")
        alice_headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": alice_client.cookies["__Host-yv_csrf"],
        }
        bob_headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": bob_client.cookies["__Host-yv_csrf"],
        }
        charlie_headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": charlie_client.cookies["__Host-yv_csrf"],
        }

        missing_csrf = await alice_client.post(
            "/api/v1/conversations/direct",
            headers={"Origin": ORIGIN},
            json={"other_user_id": str(bob.id)},
        )
        assert missing_csrf.status_code == 403

        direct = await alice_client.post(
            "/api/v1/conversations/direct",
            headers=alice_headers,
            json={"other_user_id": str(bob.id)},
        )
        assert direct.status_code == 201
        assert FORBIDDEN_FIELDS.isdisjoint(direct.json())
        duplicate = await bob_client.post(
            "/api/v1/conversations/direct",
            headers=bob_headers,
            json={"other_user_id": str(alice.id)},
        )
        assert duplicate.status_code == 409

        group = await alice_client.post(
            "/api/v1/conversations/group",
            headers=alice_headers,
            json={"title": "MVP team", "member_user_ids": [str(bob.id)]},
        )
        assert group.status_code == 201
        group_id = UUID(group.json()["conversation_id"])

        guessed = await charlie_client.get(f"/api/v1/conversations/{group_id}")
        unknown = await charlie_client.get(f"/api/v1/conversations/{uuid4()}")
        assert guessed.status_code == unknown.status_code == 404
        assert guessed.json() == unknown.json()

        ordinary_member_add = await bob_client.post(
            f"/api/v1/conversations/{group_id}/members",
            headers=bob_headers,
            json={"user_id": str(charlie.id)},
        )
        assert ordinary_member_add.status_code == 403
        ordinary_member_rename = await bob_client.patch(
            f"/api/v1/conversations/{group_id}",
            headers=bob_headers,
            json={"title": "Denied"},
        )
        assert ordinary_member_rename.status_code == 403

        renamed = await alice_client.patch(
            f"/api/v1/conversations/{group_id}",
            headers=alice_headers,
            json={"title": "  Core team  "},
        )
        assert renamed.status_code == 200
        assert renamed.json()["title"] == "Core team"

        promoted = await alice_client.patch(
            f"/api/v1/conversations/{group_id}/members/{bob.id}",
            headers=alice_headers,
            json={"role": "admin"},
        )
        assert promoted.status_code == 200
        added = await bob_client.post(
            f"/api/v1/conversations/{group_id}/members",
            headers=bob_headers,
            json={"user_id": str(charlie.id)},
        )
        assert added.status_code == 200

        admin_escalation = await bob_client.patch(
            f"/api/v1/conversations/{group_id}/members/{charlie.id}",
            headers=bob_headers,
            json={"role": "admin"},
        )
        assert admin_escalation.status_code == 403

        left = await charlie_client.post(
            f"/api/v1/conversations/{group_id}/leave",
            headers=charlie_headers,
        )
        assert left.status_code == 204
        assert (await charlie_client.get(f"/api/v1/conversations/{group_id}")).status_code == 404

        readded = await alice_client.post(
            f"/api/v1/conversations/{group_id}/members",
            headers=alice_headers,
            json={"user_id": str(charlie.id)},
        )
        assert readded.status_code == 200
        charlie_memberships = [
            member for member in readded.json()["members"] if member["user_id"] == str(charlie.id)
        ]
        assert len(charlie_memberships) == 1
        assert charlie_memberships[0]["left_at"] is None

        alice_list = await alice_client.get("/api/v1/conversations")
        bob_list = await bob_client.get("/api/v1/conversations")
        assert len(alice_list.json()) == len(bob_list.json()) == 2


async def test_conversation_openapi_has_no_secret_or_plaintext_output_fields() -> None:
    application, _, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url=ORIGIN) as client:
        schemas = (await client.get("/openapi.json")).json()["components"]["schemas"]

    for name in ("ConversationResponse", "ConversationMemberResponse"):
        assert FORBIDDEN_FIELDS.isdisjoint(schemas[name]["properties"])
