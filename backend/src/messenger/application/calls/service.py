"""Bounded in-process state machine for authorized one-to-one call signaling."""

import asyncio
import logging
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID, uuid4

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import CallStateConflictError
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.push import PushEventType, PushNotification, PushNotifier
from messenger.application.ports.realtime import CallSignalNotifier
from messenger.application.push.publish import publish_push_best_effort
from messenger.domain.entities import ConversationType

logger = logging.getLogger(__name__)


class CallSignalType(StrEnum):
    OFFER = "call_offer"
    ANSWER = "call_answer"
    ICE_CANDIDATE = "ice_candidate"
    REJECTED = "call_rejected"
    ENDED = "call_ended"


@dataclass(frozen=True, slots=True)
class CallSignalCommand:
    signal_type: CallSignalType
    actor_user_id: UUID
    actor_device_id: UUID
    conversation_id: UUID
    call_id: UUID
    sdp: str | None = None
    candidate: str | None = None
    reason: str | None = None
    identity_signature: str | None = None


@dataclass(frozen=True, slots=True)
class CallSignalNotification:
    user_id: UUID
    event_id: UUID
    signal_type: CallSignalType
    conversation_id: UUID
    call_id: UUID
    actor_user_id: UUID
    actor_device_id: UUID
    target_device_id: UUID | None = None
    excluded_device_id: UUID | None = None
    sdp: str | None = None
    candidate: str | None = None
    reason: str | None = None
    identity_signature: str | None = None


@dataclass(frozen=True, slots=True)
class ActiveCall:
    call_id: UUID
    conversation_id: UUID
    caller_user_id: UUID
    caller_device_id: UUID
    callee_user_id: UUID
    callee_device_id: UUID | None
    offer_sdp: str
    offer_identity_signature: str
    answer_sdp: str | None
    answer_identity_signature: str | None
    caller_candidates: tuple[str, ...]
    callee_candidates: tuple[str, ...]
    expires_at: datetime


class VoiceCallCoordinator:
    """Keep only short-lived signaling state; audio always stays in WebRTC."""

    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        clock: Clock,
        realtime_notifier: CallSignalNotifier,
        push_notifier: PushNotifier,
        ringing_timeout: timedelta = timedelta(seconds=60),
        active_timeout: timedelta = timedelta(hours=8),
        maximum_candidates_per_side: int = 64,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._realtime_notifier = realtime_notifier
        self._push_notifier = push_notifier
        self._ringing_timeout = ringing_timeout
        self._active_timeout = active_timeout
        self._maximum_candidates = maximum_candidates_per_side
        self._calls: dict[UUID, ActiveCall] = {}
        self._conversation_calls: dict[UUID, UUID] = {}
        self._lock = asyncio.Lock()

    async def execute(self, command: CallSignalCommand) -> None:
        participants = await self._authorize(command)
        notifications, push = await self._transition(command, participants)
        try:
            await self._realtime_notifier.publish(notifications)
        except Exception:
            logger.warning(
                "call signaling dispatch failed",
                extra={"notification_count": len(notifications)},
            )
        if push is not None:
            await publish_push_best_effort(self._push_notifier, (push,))

    async def snapshot(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
    ) -> tuple[CallSignalNotification, ...]:
        now = self._clock.now()
        async with self._lock:
            self._purge_expired(now)
            calls = tuple(self._calls.values())
        result: list[CallSignalNotification] = []
        for call in calls:
            if user_id == call.callee_user_id and call.callee_device_id in {None, device_id}:
                result.append(
                    self._notification(
                        user_id=user_id,
                        signal_type=CallSignalType.OFFER,
                        call=call,
                        actor_user_id=call.caller_user_id,
                        actor_device_id=call.caller_device_id,
                        target_device_id=device_id,
                        sdp=call.offer_sdp,
                        identity_signature=call.offer_identity_signature,
                    )
                )
                for candidate in call.caller_candidates:
                    result.append(
                        self._notification(
                            user_id=user_id,
                            signal_type=CallSignalType.ICE_CANDIDATE,
                            call=call,
                            actor_user_id=call.caller_user_id,
                            actor_device_id=call.caller_device_id,
                            target_device_id=device_id,
                            candidate=candidate,
                        )
                    )
            elif (
                user_id == call.caller_user_id
                and device_id == call.caller_device_id
                and call.answer_sdp is not None
                and call.callee_device_id is not None
            ):
                result.append(
                    self._notification(
                        user_id=user_id,
                        signal_type=CallSignalType.ANSWER,
                        call=call,
                        actor_user_id=call.callee_user_id,
                        actor_device_id=call.callee_device_id,
                        target_device_id=device_id,
                        sdp=call.answer_sdp,
                        identity_signature=call.answer_identity_signature,
                    )
                )
                for candidate in call.callee_candidates:
                    result.append(
                        self._notification(
                            user_id=user_id,
                            signal_type=CallSignalType.ICE_CANDIDATE,
                            call=call,
                            actor_user_id=call.callee_user_id,
                            actor_device_id=call.callee_device_id,
                            target_device_id=device_id,
                            candidate=candidate,
                        )
                    )
        return tuple(result)

    async def _authorize(self, command: CallSignalCommand) -> tuple[UUID, UUID]:
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            device = await unit_of_work.devices.get_owned_by_id(
                user_id=command.actor_user_id,
                device_id=command.actor_device_id,
            )
            if device is None or device.revoked_at is not None:
                raise CallStateConflictError("active owned call device required")
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(command.conversation_id),
                command.actor_user_id,
            )
            if conversation.conversation_type is not ConversationType.DIRECT:
                raise CallStateConflictError("voice calls are limited to direct conversations")
            participants = tuple(
                sorted(
                    (member.user_id for member in conversation.members if member.is_active),
                    key=lambda value: value.int,
                )
            )
            if len(participants) != 2 or command.actor_user_id not in participants:
                raise CallStateConflictError("direct call participants are unavailable")
            return participants[0], participants[1]

    async def _transition(
        self,
        command: CallSignalCommand,
        participants: tuple[UUID, UUID],
    ) -> tuple[tuple[CallSignalNotification, ...], PushNotification | None]:
        now = self._clock.now()
        other_user_id = (
            participants[1] if participants[0] == command.actor_user_id else participants[0]
        )
        async with self._lock:
            self._purge_expired(now)
            if command.signal_type is CallSignalType.OFFER:
                return self._offer(command, other_user_id, now)
            call = self._calls.get(command.call_id)
            if call is None or call.conversation_id != command.conversation_id:
                raise CallStateConflictError("call is not active")
            if command.actor_user_id not in {call.caller_user_id, call.callee_user_id}:
                raise CallStateConflictError("call participant mismatch")
            if command.signal_type is CallSignalType.ANSWER:
                return self._answer(call, command), None
            if command.signal_type is CallSignalType.ICE_CANDIDATE:
                return self._candidate(call, command), None
            if command.signal_type is CallSignalType.REJECTED:
                return self._finish(call, command, CallSignalType.REJECTED), None
            if command.signal_type is CallSignalType.ENDED:
                return self._finish(call, command, CallSignalType.ENDED), None
            raise CallStateConflictError("unsupported call transition")

    def _offer(
        self,
        command: CallSignalCommand,
        callee_user_id: UUID,
        now: datetime,
    ) -> tuple[tuple[CallSignalNotification, ...], PushNotification]:
        if command.sdp is None or command.identity_signature is None:
            raise CallStateConflictError("call offer requires authenticated SDP")
        if command.call_id in self._calls or command.conversation_id in self._conversation_calls:
            raise CallStateConflictError("conversation already has an active call")
        call = ActiveCall(
            call_id=command.call_id,
            conversation_id=command.conversation_id,
            caller_user_id=command.actor_user_id,
            caller_device_id=command.actor_device_id,
            callee_user_id=callee_user_id,
            callee_device_id=None,
            offer_sdp=command.sdp,
            offer_identity_signature=command.identity_signature,
            answer_sdp=None,
            answer_identity_signature=None,
            caller_candidates=(),
            callee_candidates=(),
            expires_at=now + self._ringing_timeout,
        )
        self._calls[call.call_id] = call
        self._conversation_calls[call.conversation_id] = call.call_id
        notification = self._notification(
            user_id=callee_user_id,
            signal_type=CallSignalType.OFFER,
            call=call,
            actor_user_id=command.actor_user_id,
            actor_device_id=command.actor_device_id,
            sdp=command.sdp,
            identity_signature=command.identity_signature,
        )
        return (notification,), PushNotification(
            user_id=callee_user_id,
            event_id=notification.event_id,
            event_type=PushEventType.INCOMING_CALL,
            conversation_id=call.conversation_id,
            message_id=None,
            call_id=call.call_id,
        )

    def _answer(
        self,
        call: ActiveCall,
        command: CallSignalCommand,
    ) -> tuple[CallSignalNotification, ...]:
        if (
            command.actor_user_id != call.callee_user_id
            or command.sdp is None
            or command.identity_signature is None
        ):
            raise CallStateConflictError("only callee can answer with authenticated SDP")
        if call.callee_device_id is not None and call.callee_device_id != command.actor_device_id:
            selected_device_id = call.callee_device_id
            return (
                self._notification(
                    user_id=call.callee_user_id,
                    signal_type=CallSignalType.ENDED,
                    call=call,
                    actor_user_id=call.callee_user_id,
                    actor_device_id=selected_device_id,
                    target_device_id=command.actor_device_id,
                    reason="answered_elsewhere",
                ),
            )
        updated = replace(
            call,
            callee_device_id=command.actor_device_id,
            answer_sdp=command.sdp,
            answer_identity_signature=command.identity_signature,
            expires_at=self._clock.now() + self._active_timeout,
        )
        self._calls[call.call_id] = updated
        return (
            self._notification(
                user_id=call.caller_user_id,
                signal_type=CallSignalType.ANSWER,
                call=updated,
                actor_user_id=command.actor_user_id,
                actor_device_id=command.actor_device_id,
                target_device_id=call.caller_device_id,
                sdp=command.sdp,
                identity_signature=command.identity_signature,
            ),
            self._notification(
                user_id=call.callee_user_id,
                signal_type=CallSignalType.ENDED,
                call=updated,
                actor_user_id=command.actor_user_id,
                actor_device_id=command.actor_device_id,
                excluded_device_id=command.actor_device_id,
                reason="answered_elsewhere",
            ),
        )

    def _candidate(
        self,
        call: ActiveCall,
        command: CallSignalCommand,
    ) -> tuple[CallSignalNotification, ...]:
        if command.candidate is None:
            raise CallStateConflictError("ICE transition requires candidate")
        if command.actor_user_id == call.caller_user_id:
            if command.actor_device_id != call.caller_device_id:
                raise CallStateConflictError("caller device mismatch")
            if len(call.caller_candidates) >= self._maximum_candidates:
                raise CallStateConflictError("too many caller ICE candidates")
            updated = replace(call, caller_candidates=(*call.caller_candidates, command.candidate))
            target_user_id = call.callee_user_id
            target_device_id = call.callee_device_id
        else:
            if call.callee_device_id != command.actor_device_id or call.answer_sdp is None:
                raise CallStateConflictError("callee must answer before sending ICE")
            if len(call.callee_candidates) >= self._maximum_candidates:
                raise CallStateConflictError("too many callee ICE candidates")
            updated = replace(call, callee_candidates=(*call.callee_candidates, command.candidate))
            target_user_id = call.caller_user_id
            target_device_id = call.caller_device_id
        self._calls[call.call_id] = updated
        return (
            self._notification(
                user_id=target_user_id,
                signal_type=CallSignalType.ICE_CANDIDATE,
                call=updated,
                actor_user_id=command.actor_user_id,
                actor_device_id=command.actor_device_id,
                target_device_id=target_device_id,
                candidate=command.candidate,
            ),
        )

    def _finish(
        self,
        call: ActiveCall,
        command: CallSignalCommand,
        signal_type: CallSignalType,
    ) -> tuple[CallSignalNotification, ...]:
        if command.actor_user_id == call.caller_user_id:
            if command.actor_device_id != call.caller_device_id:
                raise CallStateConflictError("caller device mismatch")
            target_user_id = call.callee_user_id
            target_device_id = call.callee_device_id
        else:
            if signal_type is CallSignalType.REJECTED and command.reason == "busy":
                return ()
            if call.callee_device_id not in {None, command.actor_device_id}:
                raise CallStateConflictError("callee device mismatch")
            target_user_id = call.caller_user_id
            target_device_id = call.caller_device_id
        self._remove(call)
        notifications = [
            self._notification(
                user_id=target_user_id,
                signal_type=signal_type,
                call=call,
                actor_user_id=command.actor_user_id,
                actor_device_id=command.actor_device_id,
                target_device_id=target_device_id,
                reason=command.reason
                or ("rejected" if signal_type is CallSignalType.REJECTED else "ended"),
            ),
        ]
        if command.actor_user_id == call.callee_user_id and call.callee_device_id is None:
            notifications.append(
                self._notification(
                    user_id=call.callee_user_id,
                    signal_type=CallSignalType.ENDED,
                    call=call,
                    actor_user_id=command.actor_user_id,
                    actor_device_id=command.actor_device_id,
                    excluded_device_id=command.actor_device_id,
                    reason="declined_elsewhere",
                )
            )
        return tuple(notifications)

    def _notification(
        self,
        *,
        user_id: UUID,
        signal_type: CallSignalType,
        call: ActiveCall,
        actor_user_id: UUID,
        actor_device_id: UUID,
        target_device_id: UUID | None = None,
        excluded_device_id: UUID | None = None,
        sdp: str | None = None,
        candidate: str | None = None,
        reason: str | None = None,
        identity_signature: str | None = None,
    ) -> CallSignalNotification:
        return CallSignalNotification(
            user_id=user_id,
            event_id=uuid4(),
            signal_type=signal_type,
            conversation_id=call.conversation_id,
            call_id=call.call_id,
            actor_user_id=actor_user_id,
            actor_device_id=actor_device_id,
            target_device_id=target_device_id,
            excluded_device_id=excluded_device_id,
            sdp=sdp,
            candidate=candidate,
            reason=reason,
            identity_signature=identity_signature,
        )

    def _purge_expired(self, now: datetime) -> None:
        for call in tuple(self._calls.values()):
            if call.expires_at <= now:
                self._remove(call)

    def _remove(self, call: ActiveCall) -> None:
        self._calls.pop(call.call_id, None)
        if self._conversation_calls.get(call.conversation_id) == call.call_id:
            self._conversation_calls.pop(call.conversation_id, None)
