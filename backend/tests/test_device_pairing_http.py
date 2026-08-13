"""HTTP security contract for QR device pairing."""

import base64
import hashlib
from uuid import UUID, uuid4

from httpx import ASGITransport, AsyncClient

from messenger.domain.entities import Conversation, User
from tests.test_auth_http import NOW, build_test_application, login

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


async def test_offer_binds_two_existing_sessions_without_creating_another_device() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application, client=("203.0.113.7", 443))
    async with (
        AsyncClient(transport=transport, base_url="https://test") as trusted,
        AsyncClient(transport=transport, base_url="https://test") as candidate,
        AsyncClient(transport=transport, base_url="https://test") as competing,
    ):
        trusted_login = await login(trusted)
        candidate_login = await login(candidate)
        competing_login = await login(competing)
        assert (
            trusted_login.status_code
            == candidate_login.status_code
            == competing_login.status_code
            == 200
        )
        created = await trusted.post(
            "/api/v1/device-pairings/offers",
            headers=csrf_headers(trusted),
        )
        assert created.status_code == 200
        pairing_id = created.json()["pairing_id"]

        missing_csrf = await candidate.post(
            f"/api/v1/device-pairings/{pairing_id}/scan-existing-offer",
            headers={"Origin": "https://test"},
            json={"scan_token": created.json()["scan_token"]},
        )
        assert missing_csrf.status_code == 403
        scanned = await candidate.post(
            f"/api/v1/device-pairings/{pairing_id}/scan-existing-offer",
            headers=csrf_headers(candidate),
            json={"scan_token": created.json()["scan_token"]},
        )
        assert scanned.status_code == 200
        assert scanned.json()["candidate_device_id"] == candidate_login.json()["device_id"]
        assert len(scanned.json()["authentication_code"]) == 6

        conflict = await competing.post(
            f"/api/v1/device-pairings/{pairing_id}/scan-existing-offer",
            headers=csrf_headers(competing),
            json={"scan_token": created.json()["scan_token"]},
        )
        assert conflict.status_code == 409
        before_counts = (len(state.devices), len(state.sessions))
        approved = await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/approve",
            headers=csrf_headers(trusted),
        )
        assert approved.status_code == 200
        assert approved.json()["status"] == "authorized"
        assert approved.json()["authorized_device_id"] == candidate_login.json()["device_id"]
        assert (len(state.devices), len(state.sessions)) == before_counts

        candidate_status = await candidate.get(
            f"/api/v1/device-pairings/{pairing_id}/existing-candidate-status"
        )
        assert candidate_status.status_code == 200
        assert candidate_status.json()["status"] == "authorized"
        assert (
            await competing.get(f"/api/v1/device-pairings/{pairing_id}/existing-candidate-status")
        ).status_code == 404


async def test_authorized_pair_can_relay_only_opaque_chunks_to_exact_target() -> None:
    application, state, _ = build_test_application()
    transport = ASGITransport(app=application, client=("203.0.113.7", 443))
    async with (
        AsyncClient(transport=transport, base_url="https://test") as candidate,
        AsyncClient(transport=transport, base_url="https://test") as trusted,
    ):
        created = await candidate.post(
            "/api/v1/device-pairings/requests",
            headers={"Origin": "https://test"},
            json={
                "candidate_proof_hash": proof_hash(CANDIDATE_PROOF),
                "candidate_device_name": "New Mac PWA",
            },
        )
        pairing_id = UUID(created.json()["pairing_id"])
        login_response = await login(trusted)
        trusted_device_id = UUID(login_response.json()["device_id"])
        await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/scan-request",
            headers=csrf_headers(trusted),
            json={"scan_token": created.json()["scan_token"]},
        )
        await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/approve",
            headers=csrf_headers(trusted),
        )
        authorized = await candidate.post(
            f"/api/v1/device-pairings/{pairing_id}/authorize",
            headers={"Origin": "https://test"},
            json={"candidate_proof": CANDIDATE_PROOF},
        )
        candidate_device_id = UUID(authorized.json()["device_id"])
        user = next(iter(state.users.values()))
        peer = User.create(username="relay-peer", display_name="Relay peer", now=NOW)
        conversation = Conversation.create_direct(
            created_by=user.id,
            other_user_id=peer.id,
            now=NOW,
        )
        state.users[peer.id] = peer
        state.conversations[conversation.id] = conversation
        ciphertext = base64.b64encode(b"opaque MLS private message").decode()

        missing_csrf = await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/history-chunks",
            headers={"Origin": "https://test"},
            json={
                "target_device_id": str(candidate_device_id),
                "conversation_id": str(conversation.id),
                "client_chunk_id": str(uuid4()),
                "ciphertext_base64": ciphertext,
            },
        )
        assert missing_csrf.status_code == 403

        client_chunk_id = uuid4()
        uploaded = await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/history-chunks",
            headers=csrf_headers(trusted),
            json={
                "target_device_id": str(candidate_device_id),
                "conversation_id": str(conversation.id),
                "client_chunk_id": str(client_chunk_id),
                "ciphertext_base64": ciphertext,
            },
        )
        assert uploaded.status_code == 200
        assert uploaded.json()["ciphertext_base64"] == ciphertext
        assert uploaded.json()["sender_device_id"] == str(trusted_device_id)

        wrong_target = await trusted.post(
            f"/api/v1/device-pairings/{pairing_id}/history-chunks",
            headers=csrf_headers(trusted),
            json={
                "target_device_id": str(uuid4()),
                "conversation_id": str(conversation.id),
                "client_chunk_id": str(uuid4()),
                "ciphertext_base64": ciphertext,
            },
        )
        assert wrong_target.status_code == 404

        incoming = await candidate.get(f"/api/v1/device-pairings/{pairing_id}/history-chunks")
        assert incoming.status_code == 200
        assert [item["client_chunk_id"] for item in incoming.json()] == [str(client_chunk_id)]
        ack = await candidate.post(
            f"/api/v1/device-pairings/{pairing_id}/history-chunks/{uploaded.json()['chunk_id']}/ack",
            headers=csrf_headers(candidate),
        )
        assert ack.status_code == 200
        assert (
            await candidate.get(f"/api/v1/device-pairings/{pairing_id}/history-chunks")
        ).json() == []
