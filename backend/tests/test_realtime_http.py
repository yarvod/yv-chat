"""WebSocket handshake security tests."""

import base64
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from messenger.domain.entities import Conversation, User
from tests.test_auth_http import PASSWORD, build_test_application


def login(client: TestClient) -> None:
    login_as(client, "alice")


def login_as(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        headers={"Origin": "https://test"},
        json={
            "username": username,
            "password": PASSWORD,
            "device_name": "Browser",
        },
    )
    assert response.status_code == 200


def authenticated_headers(client: TestClient, origin: str = "https://test") -> dict[str, str]:
    credential = client.cookies["__Host-yv_session"]
    return {
        "Origin": origin,
        "Cookie": f"__Host-yv_session={credential}",
    }


def test_realtime_requires_exact_origin_and_cookie() -> None:
    application, _, _ = build_test_application()
    with TestClient(application, base_url="https://test") as anonymous:
        with (
            pytest.raises(WebSocketDisconnect) as missing_cookie,
            anonymous.websocket_connect(
                "/api/v1/realtime",
                headers={"Origin": "https://test"},
            ),
        ):
            pass
        assert missing_cookie.value.code == 4401

    application, _, _ = build_test_application()
    with TestClient(application, base_url="https://test") as client:
        login(client)
        credential = client.cookies["__Host-yv_session"]
        with (
            pytest.raises(WebSocketDisconnect) as missing_origin,
            client.websocket_connect(
                "/api/v1/realtime",
                headers={"Cookie": f"__Host-yv_session={credential}"},
            ),
        ):
            pass
        assert missing_origin.value.code == 4403
        with (
            pytest.raises(WebSocketDisconnect) as wrong_origin,
            client.websocket_connect(
                "/api/v1/realtime",
                headers=authenticated_headers(client, "https://evil.example"),
            ),
        ):
            pass
        assert wrong_origin.value.code == 4403


def test_realtime_hello_and_pong_do_not_expose_or_touch_credentials() -> None:
    application, state, _ = build_test_application()
    with TestClient(application, base_url="https://test") as client:
        login(client)
        session = next(iter(state.sessions.values()))
        device = state.devices[session.device_id]
        with client.websocket_connect(
            "/api/v1/realtime",
            headers=authenticated_headers(client),
        ) as websocket:
            assert websocket.receive_json() == {"type": "hello"}
            websocket.send_json({"type": "pong"})
        assert state.sessions[session.id].last_seen_at == session.last_seen_at
        assert state.devices[device.id].last_seen_at == device.last_seen_at

        with client.websocket_connect(
            "/api/v1/realtime",
            headers=authenticated_headers(client),
        ) as websocket:
            assert websocket.receive_json() == {"type": "hello"}
            websocket.send_json({"type": "unexpected", "credential": "ignored"})
            with pytest.raises(WebSocketDisconnect) as malformed:
                websocket.receive_json()
            assert malformed.value.code == 4400

        with client.websocket_connect(
            "/api/v1/realtime",
            headers=authenticated_headers(client),
        ) as websocket:
            assert websocket.receive_json() == {"type": "hello"}
            websocket.send_text("{malformed-json")
            with pytest.raises(WebSocketDisconnect) as malformed_json:
                websocket.receive_json()
            assert malformed_json.value.code == 4400


def test_committed_message_emits_only_an_opaque_wakeup_hint() -> None:
    application, state, clock = build_test_application()
    alice = next(iter(state.users.values()))
    bob = User.create(username="bob", display_name="Bob", now=clock.instant)
    conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=clock.instant,
    )
    state.users[bob.id] = bob
    state.conversations[conversation.id] = conversation

    with TestClient(application, base_url="https://test") as client:
        login(client)
        with client.websocket_connect(
            "/api/v1/realtime",
            headers=authenticated_headers(client),
        ) as websocket:
            assert websocket.receive_json() == {"type": "hello"}
            csrf = client.cookies["__Host-yv_csrf"]
            response = client.post(
                f"/api/v1/conversations/{conversation.id}/messages",
                headers={"Origin": "https://test", "X-CSRF-Token": csrf},
                json={
                    "client_message_id": str(uuid4()),
                    "protocol_version": 1,
                    "ciphertext_base64": base64.b64encode(b"opaque").decode(),
                },
            )
            assert response.status_code == 201
            notification = websocket.receive_json()

    assert set(notification) == {"type", "event_id", "conversation_id", "message_id"}
    assert notification["type"] == "new_message"
    assert UUID(notification["event_id"])
    assert notification["conversation_id"] == str(conversation.id)
    assert notification["message_id"] == response.json()["message_id"]
    assert "ciphertext" not in notification


def test_typing_is_authorized_ephemeral_and_not_written_to_sync() -> None:
    application, state, clock = build_test_application()
    alice = next(iter(state.users.values()))
    bob = User.create(username="bob", display_name="Bob", now=clock.instant)
    charlie = User.create(username="charlie", display_name="Charlie", now=clock.instant)
    for user in (bob, charlie):
        state.users[user.id] = user
        state.password_hashes[user.id] = "$argon2id$fake-hash"
    conversation = Conversation.create_direct(
        created_by=alice.id,
        other_user_id=bob.id,
        now=clock.instant,
    )
    state.conversations[conversation.id] = conversation

    with (
        TestClient(application, base_url="https://test") as alice_client,
        TestClient(application, base_url="https://test") as bob_client,
        TestClient(application, base_url="https://test") as charlie_client,
    ):
        login_as(alice_client, "alice")
        login_as(bob_client, "bob")
        login_as(charlie_client, "charlie")
        with (
            bob_client.websocket_connect(
                "/api/v1/realtime",
                headers=authenticated_headers(bob_client),
            ) as bob_socket,
            alice_client.websocket_connect(
                "/api/v1/realtime",
                headers=authenticated_headers(alice_client),
            ) as alice_socket,
        ):
            assert bob_socket.receive_json() == {"type": "hello"}
            assert alice_socket.receive_json() == {"type": "hello"}
            alice_online = bob_socket.receive_json()
            assert alice_online["type"] == "presence"
            assert alice_online["actor_user_id"] == str(alice.id)
            assert alice_online["online"] is True
            bob_snapshot = alice_socket.receive_json()
            assert bob_snapshot["type"] == "presence"
            assert bob_snapshot["actor_user_id"] == str(bob.id)
            assert bob_snapshot["online"] is True
            alice_socket.send_json(
                {
                    "type": "typing",
                    "conversation_id": str(conversation.id),
                    "active": True,
                }
            )
            started = bob_socket.receive_json()
            assert set(started) == {
                "type",
                "event_id",
                "conversation_id",
                "message_id",
                "actor_user_id",
                "active",
                "expires_at",
            }
            assert started["type"] == "typing"
            assert started["actor_user_id"] == str(alice.id)
            assert started["active"] is True
            assert started["expires_at"] == "2026-08-11T12:00:05+00:00"
            alice_socket.send_json(
                {
                    "type": "typing",
                    "conversation_id": str(conversation.id),
                    "active": False,
                }
            )
            stopped = bob_socket.receive_json()
            assert stopped["active"] is False
            assert stopped["expires_at"] == "2026-08-11T12:00:00+00:00"

        sync = bob_client.get("/api/v1/sync?after=0&limit=10")
        assert sync.status_code == 200
        assert sync.json()["events"] == []

        with charlie_client.websocket_connect(
            "/api/v1/realtime",
            headers=authenticated_headers(charlie_client),
        ) as foreign_socket:
            assert foreign_socket.receive_json() == {"type": "hello"}
            foreign_socket.send_json(
                {
                    "type": "typing",
                    "conversation_id": str(conversation.id),
                    "active": True,
                }
            )
            with pytest.raises(WebSocketDisconnect) as forbidden:
                foreign_socket.receive_json()
            assert forbidden.value.code == 4403


def test_typing_frame_rejects_client_claimed_actor_or_expiry() -> None:
    application, _, _ = build_test_application()
    with TestClient(application, base_url="https://test") as client:
        login(client)
        with client.websocket_connect(
            "/api/v1/realtime",
            headers=authenticated_headers(client),
        ) as websocket:
            assert websocket.receive_json() == {"type": "hello"}
            websocket.send_json(
                {
                    "type": "typing",
                    "conversation_id": str(uuid4()),
                    "active": True,
                    "actor_user_id": str(uuid4()),
                }
            )
            with pytest.raises(WebSocketDisconnect) as malformed:
                websocket.receive_json()
            assert malformed.value.code == 4400
