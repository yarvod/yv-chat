"""Browser authentication transport security tests."""

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from messenger.application.session_policy import SessionPolicy
from messenger.application.use_cases.authenticate_session import AuthenticateSession
from messenger.application.use_cases.login import Login
from messenger.application.use_cases.logout import Logout
from messenger.bootstrap.app import create_app
from messenger.bootstrap.container import AuthServices
from messenger.bootstrap.settings import AppEnvironment, AppSettings
from messenger.domain.entities import User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FakePasswordHasher,
    FixedSessionCredentials,
    IdentityState,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
PASSWORD = "correct horse battery staple"
POLICY = SessionPolicy(
    idle_timeout=timedelta(hours=2),
    absolute_lifetime=timedelta(hours=3),
    rotation_interval=timedelta(hours=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)
DATABASE_URL = "postgresql+asyncpg://test:test@127.0.0.1:5432/test"


@dataclass(slots=True)
class MutableClock:
    instant: datetime

    def now(self) -> datetime:
        return self.instant


def build_test_application(
    *,
    trusted_proxy_cidrs: list[str] | None = None,
) -> tuple[FastAPI, IdentityState, MutableClock]:
    user = User.create(username="alice", display_name="Alice", now=NOW)
    state = IdentityState(
        users={user.id: user},
        password_hashes={user.id: "$argon2id$fake-hash"},
    )
    passwords = FakePasswordHasher()
    passwords.hashed_passwords.append(PASSWORD)
    credentials = FixedSessionCredentials()
    clock = MutableClock(NOW)
    factory = FakeIdentityUnitOfWorkFactory(state)
    services = AuthServices(
        login=Login(
            unit_of_work=factory,
            clock=clock,
            passwords=passwords,
            credentials=credentials,
            policy=POLICY,
        ),
        authenticate_session=AuthenticateSession(
            unit_of_work=factory,
            clock=clock,
            credentials=credentials,
            policy=POLICY,
        ),
        logout=Logout(unit_of_work=factory, clock=clock, credentials=credentials),
    )
    settings = AppSettings(
        app_env=AppEnvironment.TEST,
        database_url=DATABASE_URL,
        allowed_origins=["https://test"],
        trusted_proxy_cidrs=trusted_proxy_cidrs or [],
        session_idle_timeout_seconds=7200,
        session_absolute_lifetime_seconds=10800,
        session_rotation_interval_seconds=3600,
        session_previous_token_grace_seconds=60,
        session_touch_interval_seconds=300,
    )
    return create_app(settings, auth_services=services), state, clock


async def login(client: AsyncClient) -> Response:
    return await client.post(
        "/api/v1/auth/login",
        headers={"Origin": "https://test"},
        json={
            "username": "alice",
            "password": PASSWORD,
            "device_name": "Browser",
        },
    )


async def run_cookie_flow() -> None:
    application, state, clock = build_test_application()
    transport = ASGITransport(app=application, client=("203.0.113.7", 443))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        login_response = await login(client)
        assert login_response.status_code == 200
        assert "session_credential" not in login_response.json()
        cookie_headers = login_response.headers.get_list("set-cookie")
        session_header = next(header for header in cookie_headers if "__Host-yv_session=" in header)
        csrf_header = next(header for header in cookie_headers if "__Host-yv_csrf=" in header)
        assert "Secure" in session_header
        assert "HttpOnly" in session_header
        assert "SameSite=strict" in session_header
        assert "Path=/" in session_header
        assert "Domain=" not in session_header
        assert "Secure" in csrf_header
        assert "HttpOnly" not in csrf_header

        current = await client.get("/api/v1/auth/session")
        assert current.status_code == 200
        assert "set-cookie" not in current.headers

        original_credential = client.cookies["__Host-yv_session"]
        clock.instant = NOW + timedelta(hours=1)
        rotated = await client.get("/api/v1/auth/session")
        assert rotated.status_code == 200
        assert "__Host-yv_session=" in rotated.headers["set-cookie"]
        assert client.cookies["__Host-yv_session"] != original_credential

        csrf_value = client.cookies["__Host-yv_csrf"]
        forbidden = await client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "https://evil.example", "X-CSRF-Token": csrf_value},
        )
        assert forbidden.status_code == 403
        assert next(iter(state.sessions.values())).revoked_at is None

        missing_csrf = await client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "https://test"},
        )
        assert missing_csrf.status_code == 403

        logged_out = await client.post(
            "/api/v1/auth/logout",
            headers={"Origin": "https://test", "X-CSRF-Token": csrf_value},
        )
        assert logged_out.status_code == 204
        assert next(iter(state.sessions.values())).revoked_at == clock.instant


def test_login_session_rotation_and_csrf_logout_cookie_flow() -> None:
    asyncio.run(run_cookie_flow())


async def run_cookie_only_auth() -> None:
    application, _, _ = build_test_application()
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.get(
            "/api/v1/auth/session?session_credential=opaque-session-1",
            headers={"Authorization": "Bearer opaque-session-1"},
        )
        assert response.status_code == 401

        missing_origin = await client.post(
            "/api/v1/auth/login",
            json={
                "username": "alice",
                "password": PASSWORD,
                "device_name": "Browser",
            },
        )
        assert missing_origin.status_code == 403

        invalid_login = await client.post(
            "/api/v1/auth/login",
            headers={"Origin": "https://test"},
            json={
                "username": "unknown",
                "password": "incorrect password",
                "device_name": "Browser",
            },
        )
        assert invalid_login.status_code == 401
        assert invalid_login.json() == {"detail": "invalid username or password"}

        openapi = (await client.get("/openapi.json")).json()
        response_properties = openapi["components"]["schemas"]["SessionResponse"]["properties"]
        assert "session_credential" not in response_properties
        assert "password" not in response_properties


def test_session_does_not_accept_bearer_or_query_credentials() -> None:
    asyncio.run(run_cookie_only_auth())


async def run_client_ip_flow(trusted: bool) -> str | None:
    cidrs = ["10.0.0.0/8"] if trusted else []
    application, state, _ = build_test_application(trusted_proxy_cidrs=cidrs)
    transport = ASGITransport(app=application, client=("10.0.0.5", 443))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            headers={
                "Origin": "https://test",
                "X-Forwarded-For": "198.51.100.9",
            },
            json={
                "username": "alice",
                "password": PASSWORD,
                "device_name": "Browser",
            },
        )
        assert response.status_code == 200
    return next(iter(state.devices.values())).login_ip


def test_forwarded_ip_is_ignored_unless_socket_peer_is_trusted() -> None:
    assert asyncio.run(run_client_ip_flow(trusted=False)) == "10.0.0.5"
    assert asyncio.run(run_client_ip_flow(trusted=True)) == "198.51.100.9"


def test_production_rejects_insecure_origin() -> None:
    try:
        AppSettings(
            app_env=AppEnvironment.PRODUCTION,
            database_url=DATABASE_URL,
            allowed_origins=["http://chat.example"],
        )
    except ValueError as error:
        assert "HTTPS" in str(error)
    else:
        raise AssertionError("insecure production origin was accepted")
