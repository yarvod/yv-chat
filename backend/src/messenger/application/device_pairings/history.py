"""Authorized, opaque MLS application-message relay for paired devices."""

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.errors import (
    DeviceHistorySyncCancelledError,
    DevicePairingNotFoundError,
    DevicePairingStateError,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWork, IdentityUnitOfWorkFactory
from messenger.domain.entities import (
    ConversationType,
    DeviceHistoryChunk,
    DevicePairing,
    DevicePairingStatus,
)
from messenger.domain.exceptions import DomainValidationError

# Twenty bounded record chunks plus one encrypted per-conversation completion marker.
MAX_CHUNKS_PER_DIRECTION_CONVERSATION = 21
MAX_CIPHERTEXT_BYTES = 512_000
LIST_LIMIT = 20
OUTBOUND_LIST_LIMIT = 400


@dataclass(frozen=True, slots=True)
class UploadHistoryChunkCommand:
    pairing_id: UUID
    user_id: UUID
    session_id: UUID
    device_id: UUID
    target_device_id: UUID
    conversation_id: UUID
    client_chunk_id: UUID
    ciphertext_base64: str


@dataclass(frozen=True, slots=True)
class ListHistoryChunksQuery:
    pairing_id: UUID
    user_id: UUID
    session_id: UUID
    device_id: UUID
    after_sequence: int


@dataclass(frozen=True, slots=True)
class AcknowledgeHistoryChunkCommand:
    pairing_id: UUID
    chunk_id: UUID
    user_id: UUID
    session_id: UUID
    device_id: UUID


async def _load_pairing_actor(
    uow: IdentityUnitOfWork,
    *,
    pairing_id: UUID,
    user_id: UUID,
    session_id: UUID,
    device_id: UUID,
    now: datetime,
    policy: DevicePairingPolicy,
) -> tuple[DevicePairing, UUID]:
    preview = await uow.device_pairings.get_by_id(pairing_id)
    target_device_id, _ = _resolve_pairing_actor(
        preview,
        user_id=user_id,
        session_id=session_id,
        device_id=device_id,
        now=now,
        policy=policy,
    )
    assert preview is not None
    assert preview.trusted_device_id is not None
    assert preview.authorized_device_id is not None
    await uow.device_pairings.lock_history_pair(
        user_id=user_id,
        first_device_id=preview.trusted_device_id,
        second_device_id=preview.authorized_device_id,
    )
    pairing = await uow.device_pairings.get_by_id_for_update(pairing_id)
    locked_target_device_id, counterpart_session_id = _resolve_pairing_actor(
        pairing,
        user_id=user_id,
        session_id=session_id,
        device_id=device_id,
        now=now,
        policy=policy,
    )
    if locked_target_device_id != target_device_id:
        raise DevicePairingNotFoundError("pairing binding changed")

    assert pairing is not None
    current_session = await uow.sessions.get_by_id(session_id)
    current_device = await uow.devices.get_by_id(device_id)
    target_session = (
        await uow.sessions.get_by_id(counterpart_session_id)
        if counterpart_session_id is not None
        else None
    )
    target_device = await uow.devices.get_by_id(target_device_id)
    if any(
        value is None for value in (current_session, current_device, target_session, target_device)
    ):
        raise DevicePairingNotFoundError("pairing devices are inactive")
    assert current_session is not None
    assert current_device is not None
    assert target_session is not None
    assert target_device is not None
    if (
        current_session.user_id != user_id
        or current_session.device_id != device_id
        or current_session.revoked_at is not None
        or current_session.is_expired(now)
        or current_device.user_id != user_id
        or current_device.revoked_at is not None
        or target_session.user_id != user_id
        or target_session.device_id != target_device_id
        or target_session.revoked_at is not None
        or target_session.is_expired(now)
        or target_device.user_id != user_id
        or target_device.revoked_at is not None
    ):
        raise DevicePairingNotFoundError("pairing devices are inactive")
    return pairing, target_device_id


def _resolve_pairing_actor(
    pairing: DevicePairing | None,
    *,
    user_id: UUID,
    session_id: UUID,
    device_id: UUID,
    now: datetime,
    policy: DevicePairingPolicy,
) -> tuple[UUID, UUID | None]:
    if (
        pairing is None
        or pairing.status is not DevicePairingStatus.AUTHORIZED
        or pairing.user_id != user_id
        or now >= pairing.expires_at + policy.retention
    ):
        raise DevicePairingNotFoundError("pairing not found")
    if pairing.trusted_device_id is None or pairing.authorized_device_id is None:
        raise DevicePairingNotFoundError("pairing not found")
    if device_id == pairing.trusted_device_id and session_id == pairing.trusted_session_id:
        target_device_id = pairing.authorized_device_id
        counterpart_session_id = pairing.authorized_session_id
    elif device_id == pairing.authorized_device_id and session_id == pairing.authorized_session_id:
        target_device_id = pairing.trusted_device_id
        counterpart_session_id = pairing.trusted_session_id
    else:
        raise DevicePairingNotFoundError("pairing not found")

    if pairing.history_sync_cancelled_at is not None:
        raise DeviceHistorySyncCancelledError("history sync was cancelled")
    return target_device_id, counterpart_session_id


async def _require_direct_member(
    uow: IdentityUnitOfWork,
    *,
    conversation_id: UUID,
    user_id: UUID,
) -> None:
    conversation = await uow.conversations.get_by_id(conversation_id)
    if (
        conversation is None
        or conversation.conversation_type is not ConversationType.DIRECT
        or not any(
            member.user_id == user_id and member.is_active for member in conversation.members
        )
    ):
        raise DevicePairingNotFoundError("conversation not found")


def _validate_ciphertext(value: str) -> None:
    if not value or len(value) > 700_000:
        raise DomainValidationError("invalid history ciphertext")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as error:
        raise DomainValidationError("invalid history ciphertext") from error
    if not decoded or len(decoded) > MAX_CIPHERTEXT_BYTES:
        raise DomainValidationError("invalid history ciphertext")


class UploadHistoryChunk:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        pairing_policy: DevicePairingPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = pairing_policy

    async def execute(self, command: UploadHistoryChunkCommand) -> DeviceHistoryChunk:
        _validate_ciphertext(command.ciphertext_base64)
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            pairing, target_device_id = await _load_pairing_actor(
                uow,
                pairing_id=command.pairing_id,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
                now=now,
                policy=self._policy,
            )
            if command.target_device_id != target_device_id:
                raise DevicePairingNotFoundError("pairing target not found")
            await _require_direct_member(
                uow,
                conversation_id=command.conversation_id,
                user_id=command.user_id,
            )
            existing = await uow.device_history_chunks.get_by_client_id(
                pairing_id=pairing.id,
                sender_device_id=command.device_id,
                client_chunk_id=command.client_chunk_id,
            )
            if existing is not None:
                if (
                    existing.target_device_id != target_device_id
                    or existing.conversation_id != command.conversation_id
                    or existing.ciphertext_base64 != command.ciphertext_base64
                ):
                    raise DevicePairingStateError("history chunk idempotency conflict")
                await uow.commit()
                return existing
            count = await uow.device_history_chunks.count_direction_conversation(
                pairing_id=pairing.id,
                sender_device_id=command.device_id,
                conversation_id=command.conversation_id,
            )
            if count >= MAX_CHUNKS_PER_DIRECTION_CONVERSATION:
                raise DevicePairingStateError("history chunk limit reached")
            chunk = DeviceHistoryChunk.create(
                pairing_id=pairing.id,
                sender_device_id=command.device_id,
                target_device_id=target_device_id,
                conversation_id=command.conversation_id,
                client_chunk_id=command.client_chunk_id,
                ciphertext_base64=command.ciphertext_base64,
                now=now,
                expires_at=pairing.expires_at + self._policy.retention,
            )
            stored = await uow.device_history_chunks.add(chunk)
            await uow.commit()
            return stored


class ListHistoryChunks:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        pairing_policy: DevicePairingPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = pairing_policy

    async def execute(self, query: ListHistoryChunksQuery) -> list[DeviceHistoryChunk]:
        if query.after_sequence < 0:
            raise DomainValidationError("invalid history cursor")
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            pairing, _ = await _load_pairing_actor(
                uow,
                pairing_id=query.pairing_id,
                user_id=query.user_id,
                session_id=query.session_id,
                device_id=query.device_id,
                now=now,
                policy=self._policy,
            )
            chunks = await uow.device_history_chunks.list_pending_for_target(
                pairing_id=pairing.id,
                target_device_id=query.device_id,
                after_sequence=query.after_sequence,
                now=now,
                limit=LIST_LIMIT,
            )
            await uow.commit()
            return chunks


class ListOutboundHistoryChunks:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        pairing_policy: DevicePairingPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = pairing_policy

    async def execute(self, query: ListHistoryChunksQuery) -> list[DeviceHistoryChunk]:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            pairing, _ = await _load_pairing_actor(
                uow,
                pairing_id=query.pairing_id,
                user_id=query.user_id,
                session_id=query.session_id,
                device_id=query.device_id,
                now=now,
                policy=self._policy,
            )
            chunks = await uow.device_history_chunks.list_for_sender(
                pairing_id=pairing.id,
                sender_device_id=query.device_id,
                now=now,
                limit=OUTBOUND_LIST_LIMIT,
            )
            await uow.commit()
            return chunks


class AcknowledgeHistoryChunk:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        pairing_policy: DevicePairingPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = pairing_policy

    async def execute(self, command: AcknowledgeHistoryChunkCommand) -> DeviceHistoryChunk:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            pairing, _ = await _load_pairing_actor(
                uow,
                pairing_id=command.pairing_id,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
                now=now,
                policy=self._policy,
            )
            chunk = await uow.device_history_chunks.get_by_id_for_update(command.chunk_id)
            if (
                chunk is None
                or chunk.pairing_id != pairing.id
                or chunk.target_device_id != command.device_id
                or chunk.expires_at <= now
            ):
                raise DevicePairingNotFoundError("history chunk not found")
            acknowledged = chunk.acknowledge(now)
            await uow.device_history_chunks.update(acknowledged)
            await uow.commit()
            return acknowledged
