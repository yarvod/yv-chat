"""Authorize and persist one opaque message envelope."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import AuthorizationDeniedError
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.domain.entities import Message


@dataclass(frozen=True, slots=True)
class SendOpaqueMessageCommand:
    actor_user_id: UUID
    actor_device_id: UUID
    conversation_id: UUID
    protocol_version: int
    ciphertext: bytes


@dataclass(frozen=True, slots=True)
class SendOpaqueMessageResult:
    message_id: UUID
    conversation_id: UUID
    sender_user_id: UUID
    sender_device_id: UUID
    protocol_version: int
    created_at: datetime


class SendOpaqueMessage:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        clock: Clock,
        message_policy: MessageEnvelopePolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = message_policy

    async def execute(self, command: SendOpaqueMessageCommand) -> SendOpaqueMessageResult:
        self._policy.validate(command.protocol_version, command.ciphertext)
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            device = await unit_of_work.devices.get_owned_by_id(
                user_id=command.actor_user_id,
                device_id=command.actor_device_id,
            )
            if device is None or device.revoked_at is not None:
                raise AuthorizationDeniedError("active owned sender device required")
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(command.conversation_id),
                command.actor_user_id,
            )
            message = Message.create(
                conversation_id=conversation.id,
                sender_user_id=command.actor_user_id,
                sender_device_id=command.actor_device_id,
                protocol_version=command.protocol_version,
                ciphertext=command.ciphertext,
                now=self._clock.now(),
            )
            await unit_of_work.messages.add(message)
            await unit_of_work.commit()
        return SendOpaqueMessageResult(
            message_id=message.id,
            conversation_id=message.conversation_id,
            sender_user_id=message.sender_user_id,
            sender_device_id=message.sender_device_id,
            protocol_version=message.protocol_version,
            created_at=message.created_at,
        )
