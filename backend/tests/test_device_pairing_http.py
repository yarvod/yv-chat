"""HTTP security contract for QR device pairing."""

import hashlib
from uuid import UUID

from httpx import ASGITransport, AsyncClient

from tests.test_auth_http import build_test_application, login

CANDIDATE_PROOF = "candidate-http-proof-secret-with-at-least-32-bytes"


def proof_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def csrf_headers(client: AsyncClient) -> dict[str, str]:
    token = client.cookies.get("__Host-yv_csrf")
    assert token is not None
    return {"Origin": "https://test", "X-CSRF-Token": token}


async def test_request_pairing_needs_origin_csrf_approval_and_candidate_proof() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application, client=("203.0.113.7", 443))
    async with (
        AsyncClient(transport=transport, base_url="https://test") as candidate,
        AsyncClient(transport=transport, base_url="https://test") as trusted,
    ):
        denied = await candidate.post(
            "/api/v1/device-pairings/requests",
            json={
                "candidate_proof_hash": proof_hash(CANDIDATE_PROOF),
                "candidate_device_name": "New Mac PWA",
            },
        )
        assert denied.status_code == 403

        created = await candidate.post(
            "/api/v1/device-pairings/requests",
            headers={"Origin": "https://test"},
            json={
                "candidate_proof_hash": proof_hash(CANDIDATE_PROOF),
                "candidate_device_name": "New Mac PWA",
            },
        )
        assert created.status_code == 200
        created_body = created.json()
        pairing_id = UUID(created_body["pairing_id"])
        scan_token = created_body["scan_token"]
        persisted = state.device_pairings[pairing_id]
        assert scan_token not in persisted.scan_token_hash
        assert CANDIDATE_PROOF not in (persisted.candidate_proof_hash or "")
        assert not state.devices

        assert (await login(trusted)).status_code == 200
        missing_csrf = await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/scan-request",
            headers={"Origin": "https://test"},
            json={"scan_token": scan_token},
        )
        assert missing_csrf.status_code == 403

        scanned = await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/scan-request",
            headers=csrf_headers(trusted),
            json={"scan_token": scan_token},
        )
        assert scanned.status_code == 200
        assert scanned.json()["status"] == "confirmation_pending"
        assert len(scanned.json()["authentication_code"]) == 6

        before_approval = await candidate.post(
            f"/api/v1/device-pairings/{pairing_id}/authorize",
            headers={"Origin": "https://test"},
            json={"candidate_proof": CANDIDATE_PROOF},
        )
        assert before_approval.status_code == 409
        assert len(state.devices) == 1

        approved = await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/approve",
            headers=csrf_headers(trusted),
        )
        assert approved.status_code == 200
        assert approved.json()["authentication_code"] == scanned.json()["authentication_code"]

        wrong = await candidate.post(
            f"/api/v1/device-pairings/{pairing_id}/authorize",
            headers={"Origin": "https://test"},
            json={"candidate_proof": "wrong-candidate-proof-secret-with-at-least-32-bytes"},
        )
        assert wrong.status_code == 404
        assert candidate.cookies.get("__Host-yv_session") is None

        authorized = await candidate.post(
            f"/api/v1/device-pairings/{pairing_id}/authorize",
            headers={"Origin": "https://test"},
            json={"candidate_proof": CANDIDATE_PROOF},
        )
        assert authorized.status_code == 200
        assert "HttpOnly" in authorized.headers.get_list("set-cookie")[0]
        assert candidate.cookies.get("__Host-yv_session") == CANDIDATE_PROOF
        assert len(state.devices) == 2
        assert len(state.sessions) == 2

        current = await candidate.get("/api/v1/me")
        assert current.status_code == 200
        assert current.json()["device_id"] == authorized.json()["device_id"]

        retry = await candidate.post(
            f"/api/v1/device-pairings/{pairing_id}/authorize",
            headers={"Origin": "https://test"},
            json={"candidate_proof": CANDIDATE_PROOF},
        )
        assert retry.status_code == 200
        assert retry.json()["session_id"] == authorized.json()["session_id"]
        assert len(state.devices) == 2
