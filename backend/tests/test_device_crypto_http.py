"""HTTP security contract for current-device public crypto registration."""

import base64
from uuid import UUID, uuid4

from httpx import ASGITransport, AsyncClient

from messenger.domain.entities import User
from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from tests.test_auth_http import PASSWORD, build_test_application, login


async def login_as(client: AsyncClient, username: str) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        headers={"Origin": "https://test"},
        json={"username": username, "password": PASSWORD, "device_name": "Browser"},
    )
    assert response.status_code == 200


async def register_crypto(
    client: AsyncClient,
    user_id: UUID,
    device_id: UUID,
    package: bytes,
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
            "signature_public_key_base64": base64.b64encode(device_id.bytes * 2).decode(),
            "key_package_base64": base64.b64encode(package).decode(),
        },
    )
    assert response.status_code == 200


async def test_current_device_crypto_identity_is_authenticated_immutable_and_public() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        path = "/api/v1/devices/current/crypto-identity"
        assert (await client.get(path)).status_code == 401
        assert (await login(client)).status_code == 200
        device = next(iter(state.devices.values()))
        credential = expected_credential_identity(device.user_id, device.id)
        headers = {
            "Origin": "https://test",
            "X-CSRF-Token": client.cookies["__Host-yv_csrf"],
        }
        payload = {
            "credential_identity_base64": base64.b64encode(credential).decode(),
            "signature_public_key_base64": base64.b64encode(bytes(range(32))).decode(),
            "key_package_base64": base64.b64encode(b"opaque-public-key-package").decode(),
        }

        missing = await client.get(path)
        created = await client.put(path, headers=headers, json=payload)
        retried = await client.put(path, headers=headers, json=payload)
        fetched = await client.get(path)
        conflict = await client.put(
            path,
            headers=headers,
            json={
                **payload,
                "signature_public_key_base64": base64.b64encode(b"x" * 32).decode(),
            },
        )

    assert missing.status_code == 404
    assert created.status_code == 200
    assert retried.json() == created.json() == fetched.json()
    assert conflict.status_code == 409
    assert set(created.json()) == {
        "created_at",
        "credential_identity_base64",
        "device_id",
        "fingerprint",
        "initial_key_package_ref",
        "protocol_version",
        "signature_public_key_base64",
        "user_id",
    }
    assert "key_package_base64" not in created.text
    assert len(state.device_crypto_identities) == 1
    assert len(state.device_key_packages) == 1


async def test_registration_requires_csrf_and_rejects_invalid_identity_payload() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        assert (await login(client)).status_code == 200
        device = next(iter(state.devices.values()))
        path = "/api/v1/devices/current/crypto-identity"
        payload = {
            "credential_identity_base64": base64.b64encode(
                expected_credential_identity(device.user_id, device.id)
            ).decode(),
            "signature_public_key_base64": base64.b64encode(bytes(32)).decode(),
            "key_package_base64": base64.b64encode(b"package").decode(),
        }
        without_csrf = await client.put(path, json=payload)
        invalid_owner = await client.put(
            path,
            headers={
                "Origin": "https://test",
                "X-CSRF-Token": client.cookies["__Host-yv_csrf"],
            },
            json={
                **payload,
                "credential_identity_base64": base64.b64encode(bytes(33)).decode(),
            },
        )

    assert without_csrf.status_code == 403
    assert invalid_owner.status_code == 422
    assert state.device_crypto_identities == {}


async def test_openapi_does_not_expose_private_or_key_package_bytes() -> None:
    application, _, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        schemas = (await client.get("/openapi.json")).json()["components"]["schemas"]

    response_fields = set(schemas["DeviceCryptoIdentityResponse"]["properties"])
    assert "key_package_base64" not in response_fields
    assert not response_fields & {
        "private_key",
        "sealed_state",
        "wrapping_key",
        "ciphertext",
    }


async def test_key_package_replenish_claim_retry_and_public_response() -> None:
    application, state, clock = build_test_application()
    alice = next(user for user in state.users.values() if user.username == "alice")
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
        alice_device = next(
            device for device in state.devices.values() if device.user_id == alice.id
        )
        bob_device = next(device for device in state.devices.values() if device.user_id == bob.id)
        await register_crypto(alice_client, alice.id, alice_device.id, b"alice-package")
        await register_crypto(bob_client, bob.id, bob_device.id, b"bob-package-one")

        bob_headers = {
            "Origin": "https://test",
            "X-CSRF-Token": bob_client.cookies["__Host-yv_csrf"],
        }
        replenished = await bob_client.post(
            "/api/v1/devices/current/key-packages",
            headers=bob_headers,
            json={
                "key_packages_base64": [
                    base64.b64encode(b"bob-package-two").decode(),
                    base64.b64encode(b"bob-package-three").decode(),
                ]
            },
        )
        assert replenished.status_code == 200
        assert replenished.json()["available_count"] == 3

        alice_headers = {
            "Origin": "https://test",
            "X-CSRF-Token": alice_client.cookies["__Host-yv_csrf"],
        }
        direct = await alice_client.post(
            "/api/v1/conversations/direct",
            headers=alice_headers,
            json={"other_user_id": str(bob.id)},
        )
        assert direct.status_code == 201
        claim_path = f"/api/v1/conversations/{direct.json()['conversation_id']}/key-package-claims"
        claim_payload = {
            "target_device_id": str(bob_device.id),
            "claim_request_id": str(uuid4()),
        }
        claimed = await alice_client.post(
            claim_path,
            headers=alice_headers,
            json=claim_payload,
        )
        retried = await alice_client.post(
            claim_path,
            headers=alice_headers,
            json=claim_payload,
        )
        inventory = await bob_client.get("/api/v1/devices/current/key-packages")

    assert claimed.status_code == 200
    assert retried.json() == claimed.json()
    assert base64.b64decode(claimed.json()["key_package_base64"]) in {
        b"bob-package-one",
        b"bob-package-two",
        b"bob-package-three",
    }
    assert inventory.json()["available_count"] == 2
    assert set(claimed.json()) == {
        "claim_request_id",
        "claimed_at",
        "conversation_id",
        "credential_identity_base64",
        "fingerprint",
        "key_package_base64",
        "package_ref",
        "protocol_version",
        "signature_public_key_base64",
        "target_device_id",
        "target_user_id",
    }
    assert not set(claimed.json()) & {"private_key", "sealed_state", "session_token"}


async def test_key_package_writes_require_csrf_and_canonical_base64() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        assert (await login(client)).status_code == 200
        device = next(iter(state.devices.values()))
        await register_crypto(client, device.user_id, device.id, b"initial")
        without_csrf = await client.post(
            "/api/v1/devices/current/key-packages",
            json={"key_packages_base64": [base64.b64encode(b"package").decode()]},
        )
        invalid = await client.post(
            "/api/v1/devices/current/key-packages",
            headers={
                "Origin": "https://test",
                "X-CSRF-Token": client.cookies["__Host-yv_csrf"],
            },
            json={"key_packages_base64": ["AAAA===="]},
        )

    assert without_csrf.status_code == 403
    assert invalid.status_code == 422
