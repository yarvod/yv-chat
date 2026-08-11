"""HTTP security contract for current-device public crypto registration."""

import base64

from httpx import ASGITransport, AsyncClient

from messenger.domain.entities.device_crypto_identity import expected_credential_identity
from tests.test_auth_http import build_test_application, login


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
