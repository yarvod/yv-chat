"""Authorize and persist one opaque message envelope."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.attachments.policy import AttachmentPolicy
from messenger.application.conversation_crypto.roster import active_crypto_roster
from messenger.application.conversations.authorization import (
    require_active_actor,
    require_active_membership,
)
from messenger.application.errors import (
    AttachmentConflictError,
    AuthorizationDeniedError,
    ConversationCryptoNotReadyError,
    MessageIdempotencyConflictError,
)
from messenger.application.messaging.policy import MessageEnvelopePolicy
from messenger.application.messaging.retention import MessageRetentionPolicy
from messenger.application.ports.clock import Clock
from messenger.application.ports.messages import MessagingUnitOfWorkFactory
from messenger.application.ports.push import PushNotification, PushNotifier
from messenger.application.ports.realtime import RealtimeNotifier
from messenger.application.push.publish import publish_push_best_effort
from messenger.application.realtime import notifications_from_sync
from messenger.application.realtime.publish import publish_best_effort
from messenger.application.sync import SyncEventType, SyncPolicy
from messenger.application.sync.emission import events_for_users
from messenger.domain.entities import (
    ConversationCryptoStatus,
    ConversationDeliveryState,
    ConversationReadState,
    ConversationType,
    Message,
)
from messenger.domain.entities.message import digest_ciphertext


@dataclass(frozen=True, slots=True)
class SendOpaqueMessageCommand:
    actor_user_id: UUID
    actor_device_id: UUID
    conversation_id: UUID
    client_message_id: UUID
    protocol_version: int
    ciphertext: bytes
    attachment_ids: tuple[UUID, ...] = ()
    crypto_generation_id: UUID | None = None
    crypto_epoch: int | None = None


@dataclass(frozen=True, slots=True)
class SendOpaqueMessageResult:
    message_id: UUID
    client_message_id: UUID
    conversation_id: UUID
    sender_user_id: UUID
    sender_device_id: UUID
    protocol_version: int
    crypto_generation_id: UUID | None
    crypto_epoch: int | None
    sequence: int
    created_at: datetime
    expires_at: datetime


class SendOpaqueMessage:
    def __init__(
        self,
        *,
        unit_of_work: MessagingUnitOfWorkFactory,
        clock: Clock,
        message_policy: MessageEnvelopePolicy,
        attachment_policy: AttachmentPolicy,
        retention_policy: MessageRetentionPolicy,
        sync_policy: SyncPolicy,
        realtime_notifier: RealtimeNotifier,
        push_notifier: PushNotifier,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = message_policy
        self._attachment_policy = attachment_policy
        self._retention_policy = retention_policy
        self._sync_policy = sync_policy
        self._realtime_notifier = realtime_notifier
        self._push_notifier = push_notifier

    async def execute(self, command: SendOpaqueMessageCommand) -> SendOpaqueMessageResult:
        self._policy.validate(command.protocol_version, command.ciphertext)
        self._attachment_policy.validate_message_attachments(command.attachment_ids)
        async with self._unit_of_work() as unit_of_work:
            await require_active_actor(unit_of_work.users, command.actor_user_id)
            device = await unit_of_work.devices.get_owned_by_id(
                user_id=command.actor_user_id,
                device_id=command.actor_device_id,
            )
            if device is None or device.revoked_at is not None:
                raise AuthorizationDeniedError("active owned sender device required")
            conversation, _ = require_active_membership(
                await unit_of_work.conversations.get_by_id(
                    command.conversation_id,
                    for_update=True,
                ),
                command.actor_user_id,
            )
            existing = await unit_of_work.messages.get_by_client_id(
                sender_device_id=command.actor_device_id,
                client_message_id=command.client_message_id,
            )
            if existing is not None:
                existing_attachments = await unit_of_work.attachments.list_for_message(existing.id)
                if (
                    existing.conversation_id != conversation.id
                    or existing.sender_user_id != command.actor_user_id
                    or existing.protocol_version != command.protocol_version
                    or existing.crypto_generation_id != command.crypto_generation_id
                    or existing.crypto_epoch != command.crypto_epoch
                    or existing.ciphertext_digest != digest_ciphertext(command.ciphertext)
                    or {item.id for item in existing_attachments} != set(command.attachment_ids)
                ):
                    raise MessageIdempotencyConflictError(
                        "client message ID was reused for different envelope"
                    )
                return result_from(existing)
            self._policy.validate_new_message_protocol(
                conversation.conversation_type,
                command.protocol_version,
            )
            if command.attachment_ids and (
                conversation.conversation_type is not ConversationType.GROUP
                or command.protocol_version != 1
            ):
                raise AttachmentConflictError(
                    "attachments are available only for non-E2EE group v1 messages"
                )
            if command.protocol_version == 2:
                generation = await unit_of_work.crypto_generations.get_current(
                    conversation.id,
                    for_update=True,
                )
                if generation is None or generation.status is not ConversationCryptoStatus.READY:
                    raise ConversationCryptoNotReadyError("current MLS generation is not ready")
                if (
                    command.crypto_generation_id != generation.id
                    or command.crypto_epoch != generation.epoch
                ):
                    raise ConversationCryptoNotReadyError(
                        "message is bound to a stale MLS generation"
                    )
                required = await unit_of_work.crypto_required_devices.list_by_generation(
                    generation.id
                )
                required_device_ids = {item.device_id for item in required}
                active_user_ids = {
                    member.user_id for member in conversation.members if member.is_active
                }
                active_devices = await unit_of_work.devices.list_active_for_users(active_user_ids)
                roster = active_crypto_roster(
                    active_user_ids=active_user_ids,
                    active_devices=active_devices,
                    identities=await unit_of_work.crypto_identities.get_by_device_ids(
                        {item.id for item in active_devices}
                    ),
                )
                if not roster.is_complete:
                    raise ConversationCryptoNotReadyError(
                        "active participant has no MLS-capable device"
                    )
                if required_device_ids != roster.device_ids:
                    raise ConversationCryptoNotReadyError(
                        "MLS roster does not match active capable conversation devices"
                    )
                if command.actor_device_id not in required_device_ids:
                    raise ConversationCryptoNotReadyError(
                        "sender device is outside current MLS roster"
                    )
            now = self._clock.now()
            attachments = await unit_of_work.attachments.get_many_for_update(command.attachment_ids)
            if len(attachments) != len(command.attachment_ids) or any(
                item.conversation_id != conversation.id
                or item.uploader_user_id != command.actor_user_id
                or item.uploader_device_id != command.actor_device_id
                or item.committed_message_id is not None
                or item.expires_at <= now
                for item in attachments
            ):
                raise AttachmentConflictError("attachment cannot be committed to message")
            sequence = await unit_of_work.messages.next_sequence(conversation.id)
            message = Message.create(
                conversation_id=conversation.id,
                client_message_id=command.client_message_id,
                sender_user_id=command.actor_user_id,
                sender_device_id=command.actor_device_id,
                protocol_version=command.protocol_version,
                sequence=sequence,
                ciphertext=command.ciphertext,
                now=now,
                retention=self._retention_policy.ciphertext_retention,
                crypto_generation_id=command.crypto_generation_id,
                crypto_epoch=command.crypto_epoch,
            )
            await unit_of_work.messages.add(message)
            for attachment in attachments:
                await unit_of_work.attachments.update(
                    attachment.commit_to_message(message.id, message.expires_at)
                )
            current_read_state = await unit_of_work.read_states.get(
                user_id=command.actor_user_id,
                conversation_id=conversation.id,
            )
            sender_read_state = (
                current_read_state.advance(message.sequence, message.created_at)
                if current_read_state is not None
                else ConversationReadState.create(
                    user_id=command.actor_user_id,
                    conversation_id=conversation.id,
                    sequence=message.sequence,
                    now=message.created_at,
                )
            )
            await unit_of_work.read_states.upsert(sender_read_state)
            current_delivery_state = await unit_of_work.delivery_states.get(
                device_id=command.actor_device_id,
                conversation_id=conversation.id,
            )
            sender_delivery_state = (
                current_delivery_state.advance(message.sequence, message.created_at)
                if current_delivery_state is not None
                else ConversationDeliveryState.create(
                    device_id=command.actor_device_id,
                    conversation_id=conversation.id,
                    sequence=message.sequence,
                    now=message.created_at,
                )
            )
            await unit_of_work.delivery_states.upsert(sender_delivery_state)
            recipients = {member.user_id for member in conversation.members if member.is_active}
            sync_events = events_for_users(
                recipients,
                event_type=SyncEventType.MESSAGE_CREATED,
                conversation_id=conversation.id,
                message_id=message.id,
                now=message.created_at,
                policy=self._sync_policy,
            )
            sync_events.extend(
                events_for_users(
                    recipients,
                    event_type=SyncEventType.READ_RECEIPT,
                    conversation_id=conversation.id,
                    message_id=None,
                    actor_user_id=command.actor_user_id,
                    read_sequence=message.sequence,
                    now=message.created_at,
                    policy=self._sync_policy,
                )
            )
            sync_events.extend(
                events_for_users(
                    recipients,
                    event_type=SyncEventType.DELIVERY_RECEIPT,
                    conversation_id=conversation.id,
                    message_id=None,
                    actor_user_id=command.actor_user_id,
                    delivery_sequence=message.sequence,
                    now=message.created_at,
                    policy=self._sync_policy,
                )
            )
            await unit_of_work.sync_events.append(sync_events)
            await unit_of_work.commit()
        await publish_best_effort(
            self._realtime_notifier,
            notifications_from_sync(sync_events),
        )
        await publish_push_best_effort(
            self._push_notifier,
            tuple(
                PushNotification(
                    user_id=event.user_id,
                    event_id=event.event_id,
                    conversation_id=conversation.id,
                    message_id=message.id,
                )
                for event in sync_events
                if event.event_type is SyncEventType.MESSAGE_CREATED
                and event.user_id != command.actor_user_id
            ),
        )
        return result_from(message)


def result_from(message: Message) -> SendOpaqueMessageResult:
    return SendOpaqueMessageResult(
        message_id=message.id,
        client_message_id=message.client_message_id,
        conversation_id=message.conversation_id,
        sender_user_id=message.sender_user_id,
        sender_device_id=message.sender_device_id,
        protocol_version=message.protocol_version,
        crypto_generation_id=message.crypto_generation_id,
        crypto_epoch=message.crypto_epoch,
        sequence=message.sequence,
        created_at=message.created_at,
        expires_at=message.expires_at,
    )
