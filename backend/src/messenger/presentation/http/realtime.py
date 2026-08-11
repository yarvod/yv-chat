"""Authenticated WebSocket wake-up transport for durable sync."""

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from time import monotonic
from typing import cast
from uuid import UUID, uuid4

from dishka import Scope
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from messenger.application.errors import (
    ConversationNotFoundError,
    RealtimeSubscriptionClosedError,
    SessionNotAuthenticatedError,
)
from messenger.application.ports.realtime import RealtimeHub, RealtimeSubscription
from messenger.application.realtime import RealtimeNotification
from messenger.application.realtime.presence import (
    ListPresenceSnapshot,
    ListPresenceSnapshotQuery,
    PublishPresence,
    PublishPresenceCommand,
)
from messenger.application.realtime.typing import PublishTyping, PublishTypingCommand
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
TYPING_REPEAT_INTERVAL_SECONDS = 0.5
MAX_TRACKED_TYPING_CONVERSATIONS = 32


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


def _notification_payload(
    notification: RealtimeNotification,
) -> dict[str, str | int | bool | None]:
    payload: dict[str, str | int | bool | None] = {
        "type": notification.event_type.value,
        "event_id": str(notification.event_id),
        "conversation_id": str(notification.conversation_id),
        "message_id": str(notification.message_id) if notification.message_id else None,
    }
    if notification.actor_user_id is not None:
        payload["actor_user_id"] = str(notification.actor_user_id)
    if notification.read_sequence is not None:
        payload["read_sequence"] = notification.read_sequence
    if notification.typing_active is not None:
        payload["active"] = notification.typing_active
    if notification.expires_at is not None:
        payload["expires_at"] = notification.expires_at.isoformat()
    if notification.presence_online is not None:
        payload["online"] = notification.presence_online
    return payload


async def _presence_snapshot(
    websocket: WebSocket,
    principal: AuthenticateSessionResult,
) -> list[dict[str, str | bool | None]]:
    session_container = websocket.state.dishka_container
    async with session_container(scope=Scope.REQUEST) as request_container:
        use_case = cast(
            ListPresenceSnapshot,
            await request_container.get(ListPresenceSnapshot),
        )
        records = await use_case.execute(ListPresenceSnapshotQuery(principal.user_id))
    return [
        {
            "type": "presence",
            "event_id": str(uuid4()),
            "conversation_id": str(record.conversation_id),
            "message_id": None,
            "actor_user_id": str(record.user_id),
            "online": True,
        }
        for record in records
    ]


async def _publish_presence(
    websocket: WebSocket,
    principal: AuthenticateSessionResult,
    online: bool,
) -> None:
    session_container = websocket.state.dishka_container
    async with session_container(scope=Scope.REQUEST) as request_container:
        use_case = cast(PublishPresence, await request_container.get(PublishPresence))
        await use_case.execute(PublishPresenceCommand(principal.user_id, online))


async def _send_notifications(
    websocket: WebSocket,
    subscription: RealtimeSubscription,
    send_lock: asyncio.Lock,
) -> None:
    while True:
        notification = await subscription.receive()
        async with send_lock:
            await websocket.send_json(_notification_payload(notification))


async def _publish_typing(
    websocket: WebSocket,
    principal: AuthenticateSessionResult,
    conversation_id: UUID,
    active: bool,
) -> None:
    session_container = websocket.state.dishka_container
    async with session_container(scope=Scope.REQUEST) as request_container:
        use_case = cast(PublishTyping, await request_container.get(PublishTyping))
        await use_case.execute(
            PublishTypingCommand(
                actor_user_id=principal.user_id,
                conversation_id=conversation_id,
                active=active,
            )
        )


async def _receive_client_frames(
    websocket: WebSocket,
    heartbeat: HeartbeatState,
    principal: AuthenticateSessionResult,
) -> None:
    tracked: dict[UUID, tuple[bool, float]] = {}
    while True:
        try:
            payload = await websocket.receive_json()
        except (TypeError, ValueError):
            await websocket.close(code=INVALID_PAYLOAD_CLOSE)
            return
        if payload == {"type": "pong"}:
            heartbeat.pong_seen_at = monotonic()
            continue
        if not isinstance(payload, dict) or set(payload) != {
            "type",
            "conversation_id",
            "active",
        }:
            await websocket.close(code=INVALID_PAYLOAD_CLOSE)
            return
        if payload.get("type") != "typing" or not isinstance(payload.get("active"), bool):
            await websocket.close(code=INVALID_PAYLOAD_CLOSE)
            return
        try:
            conversation_id = UUID(payload["conversation_id"])
        except (TypeError, ValueError):
            await websocket.close(code=INVALID_PAYLOAD_CLOSE)
            return
        active = payload["active"]
        now = monotonic()
        previous = tracked.get(conversation_id)
        if (
            previous is not None
            and previous[0] is active
            and now - previous[1] < TYPING_REPEAT_INTERVAL_SECONDS
        ):
            continue
        if active and previous is None and len(tracked) >= MAX_TRACKED_TYPING_CONVERSATIONS:
            await websocket.close(code=INVALID_PAYLOAD_CLOSE)
            return
        try:
            await _revalidate(websocket, principal)
            await _publish_typing(websocket, principal, conversation_id, active)
        except ConversationNotFoundError:
            await websocket.close(code=FORBIDDEN_CLOSE)
            return
        except SessionNotAuthenticatedError:
            await websocket.close(code=UNAUTHORIZED_CLOSE)
            return
        if active:
            tracked[conversation_id] = (active, now)
        else:
            tracked.pop(conversation_id, None)


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
    if subscription.became_online:
        await _publish_presence(websocket, principal, True)
    await websocket.send_json({"type": "hello"})
    for payload in await _presence_snapshot(websocket, principal):
        await websocket.send_json(payload)
    tasks = {
        asyncio.create_task(_send_notifications(websocket, subscription, send_lock)),
        asyncio.create_task(_receive_client_frames(websocket, heartbeat_state, principal)),
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
        became_offline = await hub.unsubscribe(subscription)
        if became_offline:
            await _publish_presence(websocket, principal, False)
            if principal.user_id in await hub.online_user_ids({principal.user_id}):
                await _publish_presence(websocket, principal, True)
