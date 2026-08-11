"""Authenticated WebSocket wake-up transport for durable sync."""

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from time import monotonic
from typing import cast

from dishka import Scope
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from messenger.application.errors import (
    RealtimeSubscriptionClosedError,
    SessionNotAuthenticatedError,
)
from messenger.application.ports.realtime import RealtimeHub, RealtimeSubscription
from messenger.application.realtime import RealtimeNotification
from messenger.application.sessions.authenticate import (
    AuthenticateSession,
    AuthenticateSessionCommand,
    AuthenticateSessionResult,
    SessionActivity,
)
from messenger.application.sessions.validate_active import (
    ValidateActiveSession,
    ValidateActiveSessionQuery,
)
from messenger.bootstrap.settings import AppSettings
from messenger.presentation.http.security import client_ip, require_allowed_origin

router = APIRouter(prefix="/api/v1/realtime", tags=["realtime"])

UNAUTHORIZED_CLOSE = 4401
FORBIDDEN_CLOSE = 4403
INVALID_PAYLOAD_CLOSE = 4400
HEARTBEAT_CLOSE = 4408


@dataclass(slots=True)
class HeartbeatState:
    pong_seen_at: float


async def _authenticate(
    websocket: WebSocket,
    settings: AppSettings,
) -> AuthenticateSessionResult:
    credential = websocket.cookies.get(settings.session_cookie_name)
    if credential is None:
        raise SessionNotAuthenticatedError("session is not authenticated")
    session_container = websocket.state.dishka_container
    async with session_container(scope=Scope.REQUEST) as request_container:
        use_case = cast(
            AuthenticateSession,
            await request_container.get(AuthenticateSession),
        )
        return await use_case.execute(
            AuthenticateSessionCommand(
                session_credential=credential,
                client_ip=client_ip(websocket, settings),
                activity=SessionActivity.WEBSOCKET_HANDSHAKE,
            )
        )


async def _revalidate(websocket: WebSocket, principal: AuthenticateSessionResult) -> None:
    session_container = websocket.state.dishka_container
    async with session_container(scope=Scope.REQUEST) as request_container:
        use_case = cast(
            ValidateActiveSession,
            await request_container.get(ValidateActiveSession),
        )
        await use_case.execute(
            ValidateActiveSessionQuery(
                user_id=principal.user_id,
                session_id=principal.session_id,
                device_id=principal.device_id,
            )
        )


def _notification_payload(notification: RealtimeNotification) -> dict[str, str | int | None]:
    payload: dict[str, str | int | None] = {
        "type": notification.event_type.value,
        "event_id": str(notification.event_id),
        "conversation_id": str(notification.conversation_id),
        "message_id": str(notification.message_id) if notification.message_id else None,
    }
    if notification.actor_user_id is not None:
        payload["actor_user_id"] = str(notification.actor_user_id)
    if notification.read_sequence is not None:
        payload["read_sequence"] = notification.read_sequence
    return payload


async def _send_notifications(
    websocket: WebSocket,
    subscription: RealtimeSubscription,
    send_lock: asyncio.Lock,
) -> None:
    while True:
        notification = await subscription.receive()
        async with send_lock:
            await websocket.send_json(_notification_payload(notification))


async def _receive_client_frames(websocket: WebSocket, heartbeat: HeartbeatState) -> None:
    while True:
        try:
            payload = await websocket.receive_json()
        except (TypeError, ValueError):
            await websocket.close(code=INVALID_PAYLOAD_CLOSE)
            return
        if payload != {"type": "pong"}:
            await websocket.close(code=INVALID_PAYLOAD_CLOSE)
            return
        heartbeat.pong_seen_at = monotonic()


async def _monitor_connection(
    websocket: WebSocket,
    principal: AuthenticateSessionResult,
    settings: AppSettings,
    heartbeat_state: HeartbeatState,
    send_lock: asyncio.Lock,
) -> None:
    heartbeat_interval = settings.realtime_heartbeat_seconds
    validation_interval = settings.realtime_revalidation_seconds
    next_heartbeat = monotonic() + heartbeat_interval
    next_validation = monotonic() + validation_interval
    while True:
        await asyncio.sleep(max(0, min(next_heartbeat, next_validation) - monotonic()))
        now = monotonic()
        if now >= next_validation:
            try:
                await _revalidate(websocket, principal)
            except SessionNotAuthenticatedError:
                await websocket.close(code=UNAUTHORIZED_CLOSE)
                return
            next_validation = now + validation_interval
        if now >= next_heartbeat:
            if now - heartbeat_state.pong_seen_at >= heartbeat_interval * 2:
                await websocket.close(code=HEARTBEAT_CLOSE)
                return
            async with send_lock:
                await websocket.send_json({"type": "ping"})
            next_heartbeat = now + heartbeat_interval


@router.websocket("")
@inject
async def realtime_notifications(
    websocket: WebSocket,
    settings: FromDishka[AppSettings],
    hub: FromDishka[RealtimeHub],
) -> None:
    try:
        require_allowed_origin(websocket, settings)
    except HTTPException:
        await websocket.close(code=FORBIDDEN_CLOSE)
        return
    try:
        principal = await _authenticate(websocket, settings)
    except SessionNotAuthenticatedError:
        await websocket.close(code=UNAUTHORIZED_CLOSE)
        return

    await websocket.accept()
    subscription = await hub.subscribe(
        user_id=principal.user_id,
        session_id=principal.session_id,
    )
    send_lock = asyncio.Lock()
    heartbeat_state = HeartbeatState(monotonic())
    await websocket.send_json({"type": "hello"})
    tasks = {
        asyncio.create_task(_send_notifications(websocket, subscription, send_lock)),
        asyncio.create_task(_receive_client_frames(websocket, heartbeat_state)),
        asyncio.create_task(
            _monitor_connection(
                websocket,
                principal,
                settings,
                heartbeat_state,
                send_lock,
            )
        ),
    }
    try:
        _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in tasks:
            with suppress(
                asyncio.CancelledError,
                WebSocketDisconnect,
                RealtimeSubscriptionClosedError,
                RuntimeError,
            ):
                await task
    finally:
        await hub.unsubscribe(subscription)
