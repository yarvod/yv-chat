"""HTTP authorization and opaque-payload contract for MLS coordination."""

import base64
from uuid import UUID, uuid4

from httpx import ASGITransport, AsyncClient

from messenger.domain.entities import User
from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from tests.test_auth_http import PASSWORD, build_test_application


async def login_as(client: AsyncClient, username: str) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        headers={"Origin": "https://test"},
        json={"username": username, "password": PASSWORD, "device_name": "Browser"},
    )
    assert response.status_code == 200


async def register_identity(
    client: AsyncClient,
    user_id: UUID,
    device_id: UUID,
    marker: int,
) -> None:
    response = await client.put(
        "/api/v1/devices/current/crypto-identity",
        headers={
            "Origin": "https://test",
            "X-CSRF-Token": client.cookies["__Host-yv_csrf"],
        },
        json={
            "credential_identity_base64": base64.b64encode(
                expected_credential_identity(user_id, device_id)
            ).decode(),
            "signature_public_key_base64": base64.b64encode(bytes([marker]) * 32).decode(),
            "key_package_base64": base64.b64encode(f"package-{device_id}".encode()).decode(),
        },
    )
    assert response.status_code == 200


async def test_bootstrap_finalize_and_device_bound_welcome_flow() -> None:
    application, state, clock = build_test_application()
    alice = next(iter(state.users.values()))
    bob = User.create(username="bob", display_name="Bob", now=clock.instant)
    state.users[bob.id] = bob
    state.password_hashes[bob.id] = "$argon2id$fake-hash"
    transport = ASGITransport(app=application)

    async with (
        AsyncClient(transport=transport, base_url="https://test") as alice_client,
        AsyncClient(transport=transport, base_url="https://test") as bob_client,
    ):
        await login_as(alice_client, "alice")
        await login_as(bob_client, "bob")
        alice_device = next(item for item in state.devices.values() if item.user_id == alice.id)
        bob_device = next(item for item in state.devices.values() if item.user_id == bob.id)
        await register_identity(alice_client, alice.id, alice_device.id, 1)
        await register_identity(bob_client, bob.id, bob_device.id, 2)
        alice_headers = {
            "Origin": "https://test",
            "X-CSRF-Token": alice_client.cookies["__Host-yv_csrf"],
        }
        direct = await alice_client.post(
            "/api/v1/conversations/direct",
            headers=alice_headers,
            json={"other_user_id": str(bob.id)},
        )
        conversation_id = direct.json()["conversation_id"]
        path = f"/api/v1/conversations/{conversation_id}/crypto"

        assert (
            await alice_client.post(
                f"{path}/bootstrap",
                json={"bootstrap_request_id": str(uuid4())},
            )
        ).status_code == 403
        bootstrap = await alice_client.post(
            f"{path}/bootstrap",
            headers=alice_headers,
            json={"bootstrap_request_id": str(uuid4())},
        )
        pending_for_bob = await bob_client.get(path)
        generation_id = bootstrap.json()["generation_id"]
        finalized = await alice_client.put(
            f"{path}/generations/{generation_id}",
            headers=alice_headers,
            json={
                "epoch": 1,
                "commit_base64": base64.b64encode(b"opaque-commit").decode(),
                "ratchet_tree_base64": base64.b64encode(b"opaque-tree").decode(),
                "welcomes": [
                    {
                        "target_device_id": str(bob_device.id),
                        "welcome_base64": base64.b64encode(b"welcome-for-bob").decode(),
                    }
                ],
            },
        )
        ready_for_bob = await bob_client.get(path)
        acknowledged = await bob_client.post(
            f"{path}/generations/{generation_id}/welcome-ack",
            headers={
                "Origin": "https://test",
                "X-CSRF-Token": bob_client.cookies["__Host-yv_csrf"],
            },
        )

    assert bootstrap.status_code == 200
    assert bootstrap.json()["status"] == "pending"
    assert pending_for_bob.status_code == 200
    assert pending_for_bob.json()["welcome"] is None
    assert finalized.status_code == 200
    assert finalized.json()["status"] == "ready"
    assert ready_for_bob.status_code == 200
    assert base64.b64decode(ready_for_bob.json()["welcome"]["welcome_base64"]) == (
        b"welcome-for-bob"
    )
    assert UUID(ready_for_bob.json()["welcome"]["target_device_id"]) == bob_device.id
    assert acknowledged.status_code == 204
    forbidden = {"private_key", "sealed_state", "message_key", "plaintext"}
    assert all(field not in bootstrap.text for field in forbidden)
