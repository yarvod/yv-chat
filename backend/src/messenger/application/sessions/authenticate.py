"""Authenticate, touch and rotate one opaque session."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from messenger.application.errors import (
    SessionCredentialReplayError,
    SessionNotAuthenticatedError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.policy import SessionPolicy
from messenger.domain.entities import SecurityEvent, SecurityEventType


class SessionActivity(StrEnum):
    HTTP = "http"
    WEBSOCKET_HANDSHAKE = "websocket_handshake"


@dataclass(frozen=True, slots=True)
class AuthenticateSessionCommand:
    """Presented credential and best-effort request metadata."""

    session_credential: str
    client_ip: str | None = None
    activity: SessionActivity = SessionActivity.HTTP


@dataclass(frozen=True, slots=True)
class AuthenticateSessionResult:
    """Authenticated principal and optional newly rotated credential."""

    user_id: UUID
    session_id: UUID
    device_id: UUID
    rotated_session_credential: str | None
    absolute_expires_at: datetime


class AuthenticateSession:
    """Serialize session transitions and preserve concurrent-request grace."""

    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        credentials: SessionCredentialService,
        policy: SessionPolicy,
        event_policy: SecurityEventPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._credentials = credentials
        self._policy = policy
        self._event_policy = event_policy

    async def execute(
        self,
        command: AuthenticateSessionCommand,
    ) -> AuthenticateSessionResult:
        now = self._clock.now()
        token_hash = self._credentials.digest(command.session_credential)
        deferred_error: SessionNotAuthenticatedError | None = None
        result: AuthenticateSessionResult | None = None

        async with self._unit_of_work() as uow:
            matched = await uow.sessions.get_by_token_hash_for_update(token_hash)
            if matched is None:
                raise SessionNotAuthenticatedError("session is not authenticated")

            session = matched.session
            if session.revoked_at is not None:
                raise SessionNotAuthenticatedError("session is not authenticated")

            user = await uow.users.get_by_id(session.user_id)
            device = await uow.devices.get_by_id(session.device_id, for_update=True)
            if (
                user is None
                or not user.is_active
                or device is None
                or device.revoked_at is not None
                or session.is_expired(now)
            ):
                await uow.sessions.update(session.revoke(now))
                await uow.commit()
                deferred_error = SessionNotAuthenticatedError("session is not authenticated")
            elif matched.matched_previous and not session.previous_token_is_valid(now):
                await uow.sessions.update(session.revoke(now))
                await uow.security_events.prune_expired(now)
                await uow.security_events.add(
                    SecurityEvent.create(
                        user_id=session.user_id,
                        event_type=SecurityEventType.CREDENTIAL_REPLAY,
                        now=now,
                        retention=self._event_policy.retention,
                        actor_session_id=session.id,
                        target_device_id=session.device_id,
                    )
                )
                await uow.commit()
                deferred_error = SessionCredentialReplayError(
                    "expired previous session credential was replayed"
                )
            else:
                rotated_plaintext: str | None = None
                changed = False
                if (
                    command.activity is SessionActivity.HTTP
                    and not matched.matched_previous
                    and session.rotation_is_due(
                        now,
                        self._policy.rotation_interval,
                    )
                ):
                    generated = self._credentials.generate()
                    session = session.rotate(
                        new_token_hash=generated.digest,
                        now=now,
                        previous_token_grace=self._policy.previous_token_grace,
                    )
                    rotated_plaintext = generated.plaintext
                    changed = True

                touch_due = session.touch_is_due(now, self._policy.touch_interval)
                ip_changed = command.client_ip is not None and command.client_ip != device.last_ip
                if touch_due:
                    session = session.touch(now, self._policy.idle_timeout)
                    changed = True
                if touch_due or ip_changed:
                    device = device.seen(now, command.client_ip)
                    await uow.devices.update(device)
                    changed = True
                if changed:
                    await uow.sessions.update(session)
                    await uow.commit()

                result = AuthenticateSessionResult(
                    user_id=session.user_id,
                    session_id=session.id,
                    device_id=session.device_id,
                    rotated_session_credential=rotated_plaintext,
                    absolute_expires_at=session.absolute_expires_at,
                )

        if deferred_error is not None:
            raise deferred_error
        if result is None:
            raise RuntimeError("session authentication completed without an outcome")
        return result
