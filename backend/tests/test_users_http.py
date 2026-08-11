"""HTTP contract tests for the safe participant directory."""

from httpx import ASGITransport, AsyncClient

from messenger.domain.entities import User
from tests.test_auth_http import NOW, build_test_application, login


async def test_authenticated_directory_excludes_inactive_and_sensitive_fields() -> None:
    application, state, _ = build_test_application()
    bob = User.create(username="bob", display_name="Bob", now=NOW, is_admin=True)
    invited = User.invite(username="charlie", display_name="Charlie", now=NOW)
    state.users[bob.id] = bob
    state.users[invited.id] = invited

    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        assert (await client.get("/api/v1/users")).status_code == 401
        assert (await login(client)).status_code == 200
        response = await client.get("/api/v1/users")

    assert response.status_code == 200
    assert [item["username"] for item in response.json()] == ["alice", "bob"]
    assert all(set(item) == {"user_id", "username", "display_name"} for item in response.json())


async def test_directory_openapi_exposes_only_public_identity_fields() -> None:
    application, _, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        schema = (await client.get("/openapi.json")).json()["components"]["schemas"]

    assert set(schema["UserDirectoryResponse"]["properties"]) == {
        "user_id",
        "username",
        "display_name",
    }
