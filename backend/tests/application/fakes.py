"""In-memory identity adapters for application specifications."""

import hashlib
from collections.abc import AsyncIterable, AsyncIterator
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from types import TracebackType
from typing import Self
from uuid import UUID, uuid4

from messenger.application.errors import DuplicateDirectConversationError, DuplicateUsernameError
from messenger.application.ports.activation_secrets import GeneratedActivationSecret
from messenger.application.ports.attachments import (
    AttachmentRepository,
    AttachmentUnitOfWork,
)
from messenger.application.ports.conversation_crypto import (
    ConversationCryptoGenerationRepository,
    ConversationCryptoRequiredDeviceRepository,
    ConversationCryptoUnitOfWork,
    ConversationCryptoWelcomeRepository,
)
from messenger.application.ports.conversations import (
    ConversationRepository,
    ConversationUnitOfWork,
)
from messenger.application.ports.device_crypto import (
    DeviceCryptoIdentityRepository,
    DeviceCryptoUnitOfWork,
    DeviceKeyPackageRepository,
)
from messenger.application.ports.identity import (
    ActivationTokenRepository,
    DeviceHistoryChunkRepository,
    DevicePairingRepository,
    DeviceRepository,
    DeviceSessionRecord,
    IdentityUnitOfWork,
    ManagedUserPageRecord,
    ManagedUserRecord,
    PasswordResetTokenRepository,
    RegistrationInvitationRepository,
    SecurityEventRepository,
    SessionCredentialMatch,
    SessionRepository,
    UserAuthenticationRecord,
    UserRepository,
)
from messenger.application.ports.media_storage import (
    MediaIntegrityError,
    MediaTooLargeError,
    StoredMedia,
)
from messenger.application.ports.messages import (
    ConversationDeliveryStateRepository,
    ConversationReadStateRepository,
    ConversationReadSummary,
    MessagePinRepository,
    MessageReactionRepository,
    MessageRepository,
    MessagingUnitOfWork,
    ParticipantDeliverySummary,
)
from messenger.application.ports.password_reset_secrets import GeneratedPasswordResetSecret
from messenger.application.ports.push import PushNotification
from messenger.application.ports.session_credentials import GeneratedSessionCredential
from messenger.application.ports.sync import SyncRepository, SyncUnitOfWork
from messenger.application.realtime import RealtimeNotification
from messenger.application.sync import PendingSyncEvent, SyncEvent
from messenger.application.sync.events import SyncStreamPage
from messenger.domain.entities import (
    ActivationToken,
    Attachment,
    Conversation,
    ConversationCryptoGeneration,
    ConversationCryptoRequiredDevice,
    ConversationCryptoStatus,
    ConversationCryptoWelcome,
    ConversationDeliveryState,
    ConversationReadState,
    Device,
    DeviceCryptoIdentity,
    DeviceHistoryChunk,
    DeviceKeyPackage,
    DevicePairing,
    DevicePairingStatus,
    Message,
    MessagePin,
    MessageReaction,
    PasswordResetToken,
    RegistrationInvitation,
    SecurityEvent,
    Session,
    User,
)


@dataclass(slots=True)
class IdentityState:
    """Shared state across fresh fake units of work."""

    users: dict[UUID, User] = field(default_factory=dict)
    tokens: dict[UUID, ActivationToken] = field(default_factory=dict)
    password_reset_tokens: dict[UUID, PasswordResetToken] = field(default_factory=dict)
    registration_invitations: dict[UUID, RegistrationInvitation] = field(default_factory=dict)
    password_hashes: dict[UUID, str] = field(default_factory=dict)
    devices: dict[UUID, Device] = field(default_factory=dict)
    device_pairings: dict[UUID, DevicePairing] = field(default_factory=dict)
    device_history_chunks: dict[UUID, DeviceHistoryChunk] = field(default_factory=dict)
    device_crypto_identities: dict[UUID, DeviceCryptoIdentity] = field(default_factory=dict)
    device_key_packages: dict[UUID, DeviceKeyPackage] = field(default_factory=dict)
    conversation_crypto_generations: dict[UUID, ConversationCryptoGeneration] = field(
        default_factory=dict
    )
    conversation_crypto_required_devices: dict[
        tuple[UUID, UUID], ConversationCryptoRequiredDevice
    ] = field(default_factory=dict)
    conversation_crypto_welcomes: dict[tuple[UUID, UUID], ConversationCryptoWelcome] = field(
        default_factory=dict
    )
    sessions: dict[UUID, Session] = field(default_factory=dict)
    security_events: dict[UUID, SecurityEvent] = field(default_factory=dict)
    conversations: dict[UUID, Conversation] = field(default_factory=dict)
    messages: dict[UUID, Message] = field(default_factory=dict)
    message_reactions: dict[tuple[UUID, UUID, str], MessageReaction] = field(default_factory=dict)
    message_pins: dict[UUID, MessagePin] = field(default_factory=dict)
    attachments: dict[UUID, Attachment] = field(default_factory=dict)
    message_sequences: dict[UUID, int] = field(default_factory=dict)
    delivery_states: dict[tuple[UUID, UUID], ConversationDeliveryState] = field(
        default_factory=dict
    )
    read_states: dict[tuple[UUID, UUID], ConversationReadState] = field(default_factory=dict)
    sync_events: list[SyncEvent] = field(default_factory=list)
    sync_cursors: dict[UUID, int] = field(default_factory=dict)
    commits: int = 0


class FakeMediaStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def new_storage_key(self) -> str:
        identifier = uuid4().hex
        return f"{identifier[:2]}/{identifier}"

    async def save(
        self,
        storage_key: str,
        chunks: AsyncIterable[bytes],
        *,
        expected_size: int,
        expected_sha256_hex: str,
        max_bytes: int,
    ) -> StoredMedia:
        body = bytearray()
        async for chunk in chunks:
            body.extend(chunk)
            if len(body) > max_bytes or len(body) > expected_size:
                raise MediaTooLargeError("fake media exceeded limit")
        digest = hashlib.sha256(body).hexdigest()
        if len(body) != expected_size or digest != expected_sha256_hex:
            raise MediaIntegrityError("fake media integrity mismatch")
        self.objects[storage_key] = bytes(body)
        return StoredMedia(size=len(body), sha256_hex=digest)

    async def open(self, storage_key: str) -> AsyncIterator[bytes]:
        yield self.objects[storage_key]

    async def delete(self, storage_key: str) -> None:
        self.objects.pop(storage_key, None)

    async def exists(self, storage_key: str) -> bool:
        return storage_key in self.objects


class FakeUserRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def list_active(self) -> list[User]:
        return sorted(
            (user for user in self._state.users.values() if user.is_active),
            key=lambda user: (user.username, user.id),
        )

    async def list_managed(
        self,
        *,
        search: str | None,
        limit: int,
        offset: int,
    ) -> ManagedUserPageRecord:
        records = [
            ManagedUserRecord(
                user=user,
                password_configured=user.id in self._state.password_hashes,
            )
            for user in sorted(
                self._state.users.values(),
                key=lambda item: (item.username, item.id),
            )
        ]
        if search is not None:
            query = search.lower()
            records = [
                record
                for record in records
                if query in record.user.username.lower()
                or query in record.user.display_name.lower()
            ]
        return ManagedUserPageRecord(
            items=records[offset : offset + limit],
            total=len(records),
        )

    async def get_managed_by_id(
        self,
        user_id: UUID,
        *,
        for_update: bool = False,
    ) -> ManagedUserRecord | None:
        del for_update
        user = self._state.users.get(user_id)
        if user is None:
            return None
        return ManagedUserRecord(
            user=user,
            password_configured=user_id in self._state.password_hashes,
        )

    async def get_by_id(self, user_id: UUID, *, for_update: bool = False) -> User | None:
        del for_update
        return self._state.users.get(user_id)

    async def get_by_username(self, username: str) -> User | None:
        normalized = username.lower()
        return next(
            (user for user in self._state.users.values() if user.username == normalized),
            None,
        )

    async def get_many_by_ids(self, user_ids: set[UUID]) -> list[User]:
        return sorted(
            (user for user_id, user in self._state.users.items() if user_id in user_ids),
            key=lambda user: (user.username, user.id),
        )

    async def get_authentication_by_username(
        self,
        username: str,
    ) -> UserAuthenticationRecord | None:
        user = await self.get_by_username(username.strip())
        if user is None:
            return None
        return UserAuthenticationRecord(
            user=user,
            password_hash=self._state.password_hashes.get(user.id),
        )

    async def get_authentication_by_id(
        self,
        user_id: UUID,
        *,
        for_update: bool = False,
    ) -> UserAuthenticationRecord | None:
        del for_update
        user = self._state.users.get(user_id)
        if user is None:
            return None
        return UserAuthenticationRecord(
            user=user,
            password_hash=self._state.password_hashes.get(user.id),
        )

    async def lock_initial_bootstrap(self) -> None:
        return None

    async def has_any(self) -> bool:
        return bool(self._state.users)

    async def add_invited(self, user: User) -> None:
        if await self.get_by_username(user.username) is not None:
            raise DuplicateUsernameError("username is already in use")
        self._state.users[user.id] = user

    async def add_active(self, user: User, password_hash: str) -> None:
        self._state.users[user.id] = user
        self._state.password_hashes[user.id] = password_hash

    async def activate(self, user: User, password_hash: str) -> None:
        self._state.users[user.id] = user
        self._state.password_hashes[user.id] = password_hash

    async def update(self, user: User) -> None:
        self._state.users[user.id] = user

    async def update_password(self, user: User, password_hash: str) -> None:
        self._state.users[user.id] = user
        self._state.password_hashes[user.id] = password_hash


class FakeActivationTokenRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, token: ActivationToken) -> None:
        self._state.tokens[token.id] = token

    async def get_by_hash_for_update(self, token_hash: str) -> ActivationToken | None:
        return next(
            (token for token in self._state.tokens.values() if token.token_hash == token_hash),
            None,
        )

    async def list_unconsumed_for_user_for_update(
        self,
        user_id: UUID,
    ) -> list[ActivationToken]:
        return sorted(
            (
                token
                for token in self._state.tokens.values()
                if token.user_id == user_id and token.used_at is None and token.revoked_at is None
            ),
            key=lambda token: token.id,
        )

    async def update_lifecycle(self, token: ActivationToken) -> None:
        self._state.tokens[token.id] = token


class FakePasswordResetTokenRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, token: PasswordResetToken) -> None:
        self._state.password_reset_tokens[token.id] = token

    async def get_by_hash_for_update(self, token_hash: str) -> PasswordResetToken | None:
        return next(
            (
                token
                for token in self._state.password_reset_tokens.values()
                if token.token_hash == token_hash
            ),
            None,
        )

    async def list_unconsumed_for_user_for_update(
        self,
        user_id: UUID,
    ) -> list[PasswordResetToken]:
        return sorted(
            (
                token
                for token in self._state.password_reset_tokens.values()
                if token.user_id == user_id and token.used_at is None and token.revoked_at is None
            ),
            key=lambda token: token.id,
        )

    async def update_lifecycle(self, token: PasswordResetToken) -> None:
        self._state.password_reset_tokens[token.id] = token


class FakeRegistrationInvitationRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, invitation: RegistrationInvitation) -> None:
        self._state.registration_invitations[invitation.id] = invitation

    async def get_by_hash_for_update(
        self,
        token_hash: str,
    ) -> RegistrationInvitation | None:
        return next(
            (
                invitation
                for invitation in self._state.registration_invitations.values()
                if invitation.token_hash == token_hash
            ),
            None,
        )

    async def get_by_id_for_update(
        self,
        invitation_id: UUID,
    ) -> RegistrationInvitation | None:
        return self._state.registration_invitations.get(invitation_id)

    async def list_recent(
        self,
        *,
        limit: int,
        offset: int,
    ) -> tuple[list[RegistrationInvitation], int]:
        items = sorted(
            self._state.registration_invitations.values(),
            key=lambda invitation: (invitation.created_at, invitation.id),
            reverse=True,
        )
        return items[offset : offset + limit], len(items)

    async def update_lifecycle(self, invitation: RegistrationInvitation) -> None:
        self._state.registration_invitations[invitation.id] = invitation


class FakeDeviceRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def get_by_id(self, device_id: UUID, *, for_update: bool = False) -> Device | None:
        del for_update
        return self._state.devices.get(device_id)

    async def get_owned_by_id(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
        for_update: bool = False,
    ) -> Device | None:
        del for_update
        device = self._state.devices.get(device_id)
        return device if device is not None and device.user_id == user_id else None

    async def list_active_for_users(self, user_ids: set[UUID]) -> list[Device]:
        return sorted(
            (
                device
                for device in self._state.devices.values()
                if device.user_id in user_ids and device.revoked_at is None
            ),
            key=lambda device: (device.user_id, device.created_at, device.id),
        )

    async def add(self, device: Device) -> None:
        self._state.devices[device.id] = device

    async def update(self, device: Device) -> None:
        self._state.devices[device.id] = device


class FakeDeviceCryptoIdentityRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def get_by_device_id(
        self,
        device_id: UUID,
        *,
        for_update: bool = False,
    ) -> DeviceCryptoIdentity | None:
        del for_update
        return self._state.device_crypto_identities.get(device_id)

    async def add(self, identity: DeviceCryptoIdentity) -> None:
        self._state.device_crypto_identities[identity.device_id] = identity

    async def get_by_device_ids(
        self,
        device_ids: set[UUID],
    ) -> list[DeviceCryptoIdentity]:
        return [
            identity
            for device_id, identity in self._state.device_crypto_identities.items()
            if device_id in device_ids
        ]


class FakeDeviceKeyPackageRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def get_initial_by_device_id(
        self,
        device_id: UUID,
    ) -> DeviceKeyPackage | None:
        packages = sorted(
            (
                package
                for package in self._state.device_key_packages.values()
                if package.device_id == device_id
            ),
            key=lambda package: (package.created_at, package.id),
        )
        return packages[0] if packages else None

    async def add(self, key_package: DeviceKeyPackage) -> None:
        self._state.device_key_packages[key_package.id] = key_package

    async def add_many(self, key_packages: tuple[DeviceKeyPackage, ...]) -> None:
        for key_package in key_packages:
            await self.add(key_package)

    async def get_by_refs(self, package_refs: set[str]) -> list[DeviceKeyPackage]:
        return [
            package
            for package in self._state.device_key_packages.values()
            if package.package_ref in package_refs
        ]

    async def get_by_ids(self, package_ids: set[UUID]) -> list[DeviceKeyPackage]:
        return [
            package
            for package_id, package in self._state.device_key_packages.items()
            if package_id in package_ids
        ]

    async def count_available(self, device_id: UUID) -> int:
        return sum(
            package.device_id == device_id and not package.is_claimed
            for package in self._state.device_key_packages.values()
        )

    async def get_by_claim_request(
        self,
        *,
        claiming_device_id: UUID,
        request_id: UUID,
        for_update: bool = False,
    ) -> DeviceKeyPackage | None:
        del for_update
        return next(
            (
                package
                for package in self._state.device_key_packages.values()
                if package.claimed_by_device_id == claiming_device_id
                and package.claim_request_id == request_id
            ),
            None,
        )

    async def get_next_available_for_update(self, device_id: UUID) -> DeviceKeyPackage | None:
        return next(
            iter(
                sorted(
                    (
                        package
                        for package in self._state.device_key_packages.values()
                        if package.device_id == device_id and not package.is_claimed
                    ),
                    key=lambda package: (package.created_at, package.id),
                )
            ),
            None,
        )

    async def update(self, key_package: DeviceKeyPackage) -> None:
        self._state.device_key_packages[key_package.id] = key_package


@dataclass(slots=True)
class RecordingRealtimeNotifier:
    notifications: list[RealtimeNotification] = field(default_factory=list)
    fail: bool = False

    async def publish(self, notifications: tuple[RealtimeNotification, ...]) -> None:
        if self.fail:
            raise RuntimeError("simulated realtime failure")
        self.notifications.extend(notifications)


@dataclass(slots=True)
class RecordingPushNotifier:
    notifications: list[PushNotification] = field(default_factory=list)
    fail: bool = False

    async def publish(self, notifications: tuple[PushNotification, ...]) -> None:
        if self.fail:
            raise RuntimeError("simulated push failure")
        self.notifications.extend(notifications)


class FakeSessionRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, session: Session) -> None:
        self._state.sessions[session.id] = session

    async def get_by_id(self, session_id: UUID) -> Session | None:
        return self._state.sessions.get(session_id)

    async def get_by_token_hash_for_update(
        self,
        token_hash: str,
    ) -> SessionCredentialMatch | None:
        for session in self._state.sessions.values():
            if session.current_token_hash == token_hash:
                return SessionCredentialMatch(session=session, matched_previous=False)
            if session.previous_token_hash == token_hash:
                return SessionCredentialMatch(session=session, matched_previous=True)
        return None

    async def update(self, session: Session) -> None:
        self._state.sessions[session.id] = session

    async def list_active_with_devices(
        self,
        *,
        user_id: UUID,
        now: datetime,
    ) -> list[DeviceSessionRecord]:
        records = [
            DeviceSessionRecord(device=self._state.devices[session.device_id], session=session)
            for session in self._state.sessions.values()
            if session.user_id == user_id
            and session.revoked_at is None
            and not session.is_expired(now)
            and self._state.devices[session.device_id].revoked_at is None
        ]
        return sorted(
            records,
            key=lambda record: (record.session.last_seen_at, record.session.id),
            reverse=True,
        )

    async def get_by_device_for_user_for_update(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
    ) -> DeviceSessionRecord | None:
        session = next(
            (
                item
                for item in self._state.sessions.values()
                if item.user_id == user_id and item.device_id == device_id
            ),
            None,
        )
        device = self._state.devices.get(device_id)
        if session is None or device is None or device.user_id != user_id:
            return None
        return DeviceSessionRecord(device=device, session=session)

    async def list_for_user_for_update(self, user_id: UUID) -> list[DeviceSessionRecord]:
        sessions = sorted(
            (session for session in self._state.sessions.values() if session.user_id == user_id),
            key=lambda session: session.id,
        )
        return [
            DeviceSessionRecord(device=self._state.devices[session.device_id], session=session)
            for session in sessions
        ]

    async def count_active_for_users(
        self,
        user_ids: set[UUID],
        *,
        now: datetime,
    ) -> dict[UUID, int]:
        counts = {user_id: 0 for user_id in user_ids}
        for session in self._state.sessions.values():
            device = self._state.devices[session.device_id]
            if (
                session.user_id in user_ids
                and session.revoked_at is None
                and not session.is_expired(now)
                and device.revoked_at is None
            ):
                counts[session.user_id] += 1
        return {user_id: count for user_id, count in counts.items() if count > 0}


class FakeDevicePairingRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, pairing: DevicePairing) -> None:
        self._state.device_pairings[pairing.id] = pairing

    async def get_by_id(self, pairing_id: UUID) -> DevicePairing | None:
        return self._state.device_pairings.get(pairing_id)

    async def get_by_id_for_update(self, pairing_id: UUID) -> DevicePairing | None:
        return self._state.device_pairings.get(pairing_id)

    async def update(self, pairing: DevicePairing) -> None:
        if pairing.id not in self._state.device_pairings:
            raise RuntimeError("pairing disappeared during update")
        self._state.device_pairings[pairing.id] = pairing

    async def lock_history_pair(
        self,
        *,
        user_id: UUID,
        first_device_id: UUID,
        second_device_id: UUID,
    ) -> None:
        del user_id, first_device_id, second_device_id

    async def cancel_other_active_history_syncs(
        self,
        *,
        pairing_id: UUID,
        user_id: UUID,
        first_device_id: UUID,
        second_device_id: UUID,
        now: datetime,
    ) -> None:
        pair = {first_device_id, second_device_id}
        for current_id, pairing in list(self._state.device_pairings.items()):
            if (
                current_id != pairing_id
                and pairing.user_id == user_id
                and pairing.status is DevicePairingStatus.AUTHORIZED
                and pairing.history_sync_cancelled_at is None
                and {pairing.trusted_device_id, pairing.authorized_device_id} == pair
            ):
                self._state.device_pairings[current_id] = pairing.cancel_history_sync(now=now)

    async def prune_expired(self, *, before: datetime) -> None:
        self._state.device_pairings = {
            pairing_id: pairing
            for pairing_id, pairing in self._state.device_pairings.items()
            if pairing.expires_at > before
        }


class FakeDeviceHistoryChunkRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, chunk: DeviceHistoryChunk) -> DeviceHistoryChunk:
        stored = replace(chunk, server_sequence=len(self._state.device_history_chunks) + 1)
        self._state.device_history_chunks[stored.id] = stored
        return stored

    async def get_by_client_id(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        client_chunk_id: UUID,
    ) -> DeviceHistoryChunk | None:
        return next(
            (
                chunk
                for chunk in self._state.device_history_chunks.values()
                if chunk.pairing_id == pairing_id
                and chunk.sender_device_id == sender_device_id
                and chunk.client_chunk_id == client_chunk_id
            ),
            None,
        )

    async def get_by_id_for_update(self, chunk_id: UUID) -> DeviceHistoryChunk | None:
        return self._state.device_history_chunks.get(chunk_id)

    async def count_direction_conversation(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        conversation_id: UUID,
    ) -> int:
        return sum(
            chunk.pairing_id == pairing_id
            and chunk.sender_device_id == sender_device_id
            and chunk.conversation_id == conversation_id
            for chunk in self._state.device_history_chunks.values()
        )

    async def list_pending_for_target(
        self,
        *,
        pairing_id: UUID,
        target_device_id: UUID,
        after_sequence: int,
        now: datetime,
        limit: int,
    ) -> list[DeviceHistoryChunk]:
        chunks = [
            chunk
            for chunk in self._state.device_history_chunks.values()
            if chunk.pairing_id == pairing_id
            and chunk.target_device_id == target_device_id
            and (chunk.server_sequence or 0) > after_sequence
            and chunk.expires_at > now
            and chunk.acknowledged_at is None
        ]
        return sorted(chunks, key=lambda chunk: chunk.server_sequence or 0)[:limit]

    async def update(self, chunk: DeviceHistoryChunk) -> None:
        if chunk.id not in self._state.device_history_chunks:
            raise RuntimeError("history chunk disappeared during update")
        self._state.device_history_chunks[chunk.id] = chunk

    async def list_for_sender(
        self,
        *,
        pairing_id: UUID,
        sender_device_id: UUID,
        now: datetime,
        limit: int,
    ) -> list[DeviceHistoryChunk]:
        chunks = [
            chunk
            for chunk in self._state.device_history_chunks.values()
            if chunk.pairing_id == pairing_id
            and chunk.sender_device_id == sender_device_id
            and chunk.expires_at > now
        ]
        return sorted(chunks, key=lambda chunk: chunk.server_sequence or 0)[:limit]


class FakeSecurityEventRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, event: SecurityEvent) -> None:
        self._state.security_events[event.id] = event

    async def list_recent(
        self,
        *,
        user_id: UUID,
        now: datetime,
        limit: int,
    ) -> list[SecurityEvent]:
        events = [
            event
            for event in self._state.security_events.values()
            if event.user_id == user_id and event.expires_at > now
        ]
        return sorted(
            events,
            key=lambda event: (event.created_at, event.id),
            reverse=True,
        )[:limit]

    async def prune_expired(self, now: datetime) -> None:
        self._state.security_events = {
            event_id: event
            for event_id, event in self._state.security_events.items()
            if event.expires_at > now
        }


class FakeIdentityUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.users: UserRepository = FakeUserRepository(state)
        self.activation_tokens: ActivationTokenRepository = FakeActivationTokenRepository(state)
        self.password_reset_tokens: PasswordResetTokenRepository = FakePasswordResetTokenRepository(
            state
        )
        self.registration_invitations: RegistrationInvitationRepository = (
            FakeRegistrationInvitationRepository(state)
        )
        self.devices: DeviceRepository = FakeDeviceRepository(state)
        self.device_pairings: DevicePairingRepository = FakeDevicePairingRepository(state)
        self.device_history_chunks: DeviceHistoryChunkRepository = FakeDeviceHistoryChunkRepository(
            state
        )
        self.sessions: SessionRepository = FakeSessionRepository(state)
        self.security_events: SecurityEventRepository = FakeSecurityEventRepository(state)
        self.conversations: ConversationRepository = FakeConversationRepository(state)
        self.sync_events: SyncRepository = FakeSyncRepository(state)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    async def commit(self) -> None:
        self._state.commits += 1


class FakeIdentityUnitOfWorkFactory:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    def __call__(self) -> IdentityUnitOfWork:
        return FakeIdentityUnitOfWork(self._state)


class FakeDeviceCryptoUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.devices: DeviceRepository = FakeDeviceRepository(state)
        self.conversations: ConversationRepository = FakeConversationRepository(state)
        self.identities: DeviceCryptoIdentityRepository = FakeDeviceCryptoIdentityRepository(state)
        self.key_packages: DeviceKeyPackageRepository = FakeDeviceKeyPackageRepository(state)
        self.sync_events: SyncRepository = FakeSyncRepository(state)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    async def commit(self) -> None:
        self._state.commits += 1


class FakeDeviceCryptoUnitOfWorkFactory:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    def __call__(self) -> DeviceCryptoUnitOfWork:
        return FakeDeviceCryptoUnitOfWork(self._state)


class FakeConversationRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, conversation: Conversation) -> None:
        if conversation.conversation_type.value == "direct":
            pair = {member.user_id for member in conversation.members}
            if any(
                item.conversation_type.value == "direct"
                and {member.user_id for member in item.members} == pair
                for item in self._state.conversations.values()
            ):
                raise DuplicateDirectConversationError("direct conversation already exists")
        self._state.conversations[conversation.id] = conversation

    async def get_by_id(
        self,
        conversation_id: UUID,
        *,
        for_update: bool = False,
    ) -> Conversation | None:
        del for_update
        return self._state.conversations.get(conversation_id)

    async def get_direct_by_users(
        self,
        first_user_id: UUID,
        second_user_id: UUID,
    ) -> Conversation | None:
        pair = {first_user_id, second_user_id}
        return next(
            (
                conversation
                for conversation in self._state.conversations.values()
                if conversation.conversation_type.value == "direct"
                and {member.user_id for member in conversation.members} == pair
            ),
            None,
        )

    async def get_by_ids(self, conversation_ids: set[UUID]) -> list[Conversation]:
        return sorted(
            (
                conversation
                for conversation_id, conversation in self._state.conversations.items()
                if conversation_id in conversation_ids
            ),
            key=lambda conversation: conversation.id.int,
        )

    async def list_active_for_user(self, user_id: UUID) -> list[Conversation]:
        return sorted(
            (
                conversation
                for conversation in self._state.conversations.values()
                if conversation.active_member(user_id) is not None
            ),
            key=lambda conversation: (conversation.updated_at, conversation.id),
            reverse=True,
        )

    async def update(self, conversation: Conversation) -> None:
        self._state.conversations[conversation.id] = conversation


class FakeConversationCryptoGenerationRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def get_current(
        self,
        conversation_id: UUID,
        *,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None:
        del for_update
        return next(
            (
                item
                for item in self._state.conversation_crypto_generations.values()
                if item.conversation_id == conversation_id and item.is_current
            ),
            None,
        )

    async def get_by_id(
        self,
        generation_id: UUID,
        *,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None:
        del for_update
        return self._state.conversation_crypto_generations.get(generation_id)

    async def get_latest_ready(
        self,
        conversation_id: UUID,
    ) -> ConversationCryptoGeneration | None:
        matching = [
            item
            for item in self._state.conversation_crypto_generations.values()
            if item.conversation_id == conversation_id
            and item.status is ConversationCryptoStatus.READY
        ]
        return max(matching, key=lambda item: item.generation_number, default=None)

    async def list_ready_for_device_after(
        self,
        *,
        conversation_id: UUID,
        device_id: UUID,
        after_generation_number: int,
        limit: int,
    ) -> list[ConversationCryptoGeneration]:
        matching = [
            item
            for item in self._state.conversation_crypto_generations.values()
            if item.conversation_id == conversation_id
            and item.status is ConversationCryptoStatus.READY
            and item.generation_number > after_generation_number
            and (item.id, device_id) in self._state.conversation_crypto_required_devices
        ]
        return sorted(matching, key=lambda item: item.generation_number)[:limit]

    async def get_by_bootstrap_request(
        self,
        *,
        coordinator_device_id: UUID,
        bootstrap_request_id: UUID,
        for_update: bool = False,
    ) -> ConversationCryptoGeneration | None:
        del for_update
        return next(
            (
                item
                for item in self._state.conversation_crypto_generations.values()
                if item.coordinator_device_id == coordinator_device_id
                and item.bootstrap_request_id == bootstrap_request_id
            ),
            None,
        )

    async def latest_generation_number(self, conversation_id: UUID) -> int:
        return max(
            (
                item.generation_number
                for item in self._state.conversation_crypto_generations.values()
                if item.conversation_id == conversation_id
            ),
            default=0,
        )

    async def add(self, generation: ConversationCryptoGeneration) -> None:
        self._state.conversation_crypto_generations[generation.id] = generation

    async def update(self, generation: ConversationCryptoGeneration) -> None:
        self._state.conversation_crypto_generations[generation.id] = generation


class FakeConversationCryptoRequiredDeviceRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def list_by_generation(
        self,
        generation_id: UUID,
    ) -> list[ConversationCryptoRequiredDevice]:
        return sorted(
            (
                item
                for (item_generation_id, _), item in (
                    self._state.conversation_crypto_required_devices.items()
                )
                if item_generation_id == generation_id
            ),
            key=lambda item: (item.user_id, item.device_id),
        )

    async def add_many(
        self,
        required_devices: tuple[ConversationCryptoRequiredDevice, ...],
    ) -> None:
        for item in required_devices:
            self._state.conversation_crypto_required_devices[
                (item.generation_id, item.device_id)
            ] = item


class FakeConversationCryptoWelcomeRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def get_for_device(
        self,
        *,
        generation_id: UUID,
        device_id: UUID,
        for_update: bool = False,
    ) -> ConversationCryptoWelcome | None:
        del for_update
        return self._state.conversation_crypto_welcomes.get((generation_id, device_id))

    async def add_many(self, welcomes: tuple[ConversationCryptoWelcome, ...]) -> None:
        for item in welcomes:
            self._state.conversation_crypto_welcomes[
                (item.generation_id, item.target_device_id)
            ] = item

    async def update(self, welcome: ConversationCryptoWelcome) -> None:
        self._state.conversation_crypto_welcomes[
            (welcome.generation_id, welcome.target_device_id)
        ] = welcome


class FakeConversationCryptoUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.conversations: ConversationRepository = FakeConversationRepository(state)
        self.devices: DeviceRepository = FakeDeviceRepository(state)
        self.identities: DeviceCryptoIdentityRepository = FakeDeviceCryptoIdentityRepository(state)
        self.key_packages: DeviceKeyPackageRepository = FakeDeviceKeyPackageRepository(state)
        self.generations: ConversationCryptoGenerationRepository = (
            FakeConversationCryptoGenerationRepository(state)
        )
        self.required_devices: ConversationCryptoRequiredDeviceRepository = (
            FakeConversationCryptoRequiredDeviceRepository(state)
        )
        self.welcomes: ConversationCryptoWelcomeRepository = (
            FakeConversationCryptoWelcomeRepository(state)
        )
        self.sync_events: SyncRepository = FakeSyncRepository(state)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    async def commit(self) -> None:
        self._state.commits += 1


class FakeConversationCryptoUnitOfWorkFactory:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    def __call__(self) -> ConversationCryptoUnitOfWork:
        return FakeConversationCryptoUnitOfWork(self._state)


class FakeConversationUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.conversations: ConversationRepository = FakeConversationRepository(state)
        self.users: UserRepository = FakeUserRepository(state)
        self.sync_events: SyncRepository = FakeSyncRepository(state)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    async def commit(self) -> None:
        self._state.commits += 1


class FakeConversationUnitOfWorkFactory:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    def __call__(self) -> ConversationUnitOfWork:
        return FakeConversationUnitOfWork(self._state)


class FakeMessageRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, message: Message) -> None:
        self._state.messages[message.id] = message

    async def get_by_client_id(
        self,
        *,
        sender_device_id: UUID,
        client_message_id: UUID,
    ) -> Message | None:
        return next(
            (
                message
                for message in self._state.messages.values()
                if message.sender_device_id == sender_device_id
                and message.client_message_id == client_message_id
            ),
            None,
        )

    async def get_by_id(
        self,
        message_id: UUID,
        *,
        for_update: bool = False,
    ) -> Message | None:
        del for_update
        return self._state.messages.get(message_id)

    async def next_sequence(self, conversation_id: UUID, *, activity_at: datetime) -> int:
        current = self._state.message_sequences.get(
            conversation_id,
            max(
                (
                    message.sequence
                    for message in self._state.messages.values()
                    if message.conversation_id == conversation_id
                ),
                default=0,
            ),
        )
        sequence = current + 1
        self._state.message_sequences[conversation_id] = sequence
        conversation = self._state.conversations.get(conversation_id)
        if conversation is not None:
            self._state.conversations[conversation_id] = replace(
                conversation,
                updated_at=activity_at,
            )
        return sequence

    async def exists_at_sequence(
        self,
        *,
        conversation_id: UUID,
        sequence: int,
    ) -> bool:
        return any(
            message.conversation_id == conversation_id and message.sequence == sequence
            for message in self._state.messages.values()
        )

    async def list_after(
        self,
        *,
        conversation_id: UUID,
        after_sequence: int,
        limit: int,
    ) -> list[Message]:
        return sorted(
            (
                message
                for message in self._state.messages.values()
                if message.conversation_id == conversation_id and message.sequence > after_sequence
            ),
            key=lambda message: (message.sequence, message.id),
        )[:limit]

    async def list_before(
        self,
        *,
        conversation_id: UUID,
        before_sequence: int | None,
        limit: int,
    ) -> list[Message]:
        matching = sorted(
            (
                message
                for message in self._state.messages.values()
                if message.conversation_id == conversation_id
                and (before_sequence is None or message.sequence < before_sequence)
            ),
            key=lambda message: (message.sequence, message.id),
            reverse=True,
        )[:limit]
        return list(reversed(matching))

    async def update(self, message: Message) -> None:
        if message.id not in self._state.messages:
            raise RuntimeError("locked message disappeared during update")
        self._state.messages[message.id] = message

    async def list_expired_active(
        self,
        *,
        now: datetime,
        limit: int,
    ) -> list[Message]:
        return sorted(
            (
                message
                for message in self._state.messages.values()
                if not message.is_deleted and message.expires_at <= now
            ),
            key=lambda message: (message.expires_at, message.id),
        )[:limit]

    async def purge_expired_tombstones(
        self,
        *,
        now: datetime,
        limit: int,
    ) -> int:
        expired = sorted(
            (
                message
                for message in self._state.messages.values()
                if message.is_deleted
                and message.tombstone_expires_at is not None
                and message.tombstone_expires_at <= now
            ),
            key=lambda message: (message.tombstone_expires_at, message.id),
        )[:limit]
        for message in expired:
            del self._state.messages[message.id]
        return len(expired)

    async def extend_active_retention(self, retention: timedelta) -> int:
        extended = 0
        for message_id, message in tuple(self._state.messages.items()):
            target_expiry = message.created_at + retention
            if not message.is_deleted and message.expires_at < target_expiry:
                self._state.messages[message_id] = replace(message, expires_at=target_expiry)
                extended += 1
        return extended


class FakeAttachmentRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, attachment: Attachment) -> None:
        self._state.attachments[attachment.id] = attachment

    async def get_by_id(
        self,
        attachment_id: UUID,
        *,
        for_update: bool = False,
    ) -> Attachment | None:
        del for_update
        return self._state.attachments.get(attachment_id)

    async def get_by_client_id(
        self,
        *,
        uploader_device_id: UUID,
        client_attachment_id: UUID,
        for_update: bool = False,
    ) -> Attachment | None:
        del for_update
        return next(
            (
                item
                for item in self._state.attachments.values()
                if item.uploader_device_id == uploader_device_id
                and item.client_attachment_id == client_attachment_id
            ),
            None,
        )

    async def get_many_for_update(self, attachment_ids: tuple[UUID, ...]) -> list[Attachment]:
        return [
            self._state.attachments[item]
            for item in sorted(attachment_ids, key=lambda value: value.int)
            if item in self._state.attachments
        ]

    async def list_for_message(self, message_id: UUID) -> list[Attachment]:
        return sorted(
            (
                item
                for item in self._state.attachments.values()
                if item.committed_message_id == message_id
            ),
            key=lambda item: item.id,
        )

    async def active_bytes_for_user(self, *, user_id: UUID, now: datetime) -> int:
        return sum(
            item.byte_size
            for item in self._state.attachments.values()
            if item.uploader_user_id == user_id and item.expires_at > now
        )

    async def update(self, attachment: Attachment) -> None:
        if attachment.id not in self._state.attachments:
            raise RuntimeError("attachment disappeared during update")
        self._state.attachments[attachment.id] = attachment

    async def list_expired(self, *, now: datetime, limit: int) -> list[Attachment]:
        return sorted(
            (item for item in self._state.attachments.values() if item.expires_at <= now),
            key=lambda item: (item.expires_at, item.id),
        )[:limit]

    async def delete(self, attachment_id: UUID) -> None:
        self._state.attachments.pop(attachment_id, None)

    async def align_committed_expiry_with_active_messages(self) -> int:
        extended = 0
        for attachment_id, attachment in tuple(self._state.attachments.items()):
            if attachment.committed_message_id is None:
                continue
            message = self._state.messages.get(attachment.committed_message_id)
            if (
                message is not None
                and not message.is_deleted
                and attachment.expires_at < message.expires_at
            ):
                self._state.attachments[attachment_id] = replace(
                    attachment,
                    expires_at=message.expires_at,
                )
                extended += 1
        return extended


class FakeConversationReadStateRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def get(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
    ) -> ConversationReadState | None:
        return self._state.read_states.get((user_id, conversation_id))

    async def upsert(self, state: ConversationReadState) -> None:
        current = self._state.read_states.get((state.user_id, state.conversation_id))
        if current is None or state.last_read_sequence > current.last_read_sequence:
            self._state.read_states[(state.user_id, state.conversation_id)] = state

    async def list_summaries(
        self,
        *,
        user_id: UUID,
        conversation_ids: set[UUID],
    ) -> list[ConversationReadSummary]:
        summaries: list[ConversationReadSummary] = []
        for conversation_id in sorted(conversation_ids, key=lambda value: value.int):
            read = self._state.read_states.get((user_id, conversation_id))
            last_read = read.last_read_sequence if read else 0
            messages = [
                message
                for message in self._state.messages.values()
                if message.conversation_id == conversation_id
            ]
            summaries.append(
                ConversationReadSummary(
                    conversation_id=conversation_id,
                    last_read_sequence=last_read,
                    latest_sequence=self._state.message_sequences.get(
                        conversation_id,
                        max((message.sequence for message in messages), default=0),
                    ),
                    unread_count=sum(
                        message.sequence > last_read and not message.is_deleted
                        for message in messages
                    ),
                )
            )
        return summaries


class FakeConversationDeliveryStateRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def get(
        self,
        *,
        device_id: UUID,
        conversation_id: UUID,
    ) -> ConversationDeliveryState | None:
        return self._state.delivery_states.get((device_id, conversation_id))

    async def upsert(self, state: ConversationDeliveryState) -> None:
        key = (state.device_id, state.conversation_id)
        current = self._state.delivery_states.get(key)
        if current is None or state.last_delivered_sequence > current.last_delivered_sequence:
            self._state.delivery_states[key] = state

    async def list_participant_summaries(
        self,
        *,
        conversation_ids: set[UUID],
    ) -> list[ParticipantDeliverySummary]:
        sequences: dict[tuple[UUID, UUID], int] = {}
        for state in self._state.delivery_states.values():
            if state.conversation_id not in conversation_ids:
                continue
            device = self._state.devices.get(state.device_id)
            if device is None or device.revoked_at is not None:
                continue
            conversation = self._state.conversations.get(state.conversation_id)
            if conversation is None or conversation.active_member(device.user_id) is None:
                continue
            key = (state.conversation_id, device.user_id)
            sequences[key] = max(sequences.get(key, 0), state.last_delivered_sequence)
        reads: dict[tuple[UUID, UUID], int] = {}
        for read_state in self._state.read_states.values():
            conversation = self._state.conversations.get(read_state.conversation_id)
            if (
                read_state.conversation_id in conversation_ids
                and conversation is not None
                and conversation.active_member(read_state.user_id) is not None
            ):
                key = (read_state.conversation_id, read_state.user_id)
                reads[key] = read_state.last_read_sequence
                sequences.setdefault(key, 0)
        return [
            ParticipantDeliverySummary(
                conversation_id,
                user_id,
                max(sequence, reads.get((conversation_id, user_id), 0)),
                reads.get((conversation_id, user_id), 0),
            )
            for (conversation_id, user_id), sequence in sorted(
                sequences.items(), key=lambda item: (item[0][0].int, item[0][1].int)
            )
        ]


class FakeMessageReactionRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def list_for_messages(
        self,
        *,
        conversation_id: UUID,
        message_ids: set[UUID],
    ) -> list[MessageReaction]:
        return sorted(
            (
                item
                for item in self._state.message_reactions.values()
                if item.message_id in message_ids
                and self._state.messages.get(item.message_id) is not None
                and self._state.messages[item.message_id].conversation_id == conversation_id
            ),
            key=lambda item: (item.message_id.int, item.created_at, item.user_id.int),
        )

    async def add(
        self,
        *,
        message_id: UUID,
        user_id: UUID,
        reaction: str,
        created_at: datetime,
    ) -> bool:
        key = (message_id, user_id, reaction)
        if key in self._state.message_reactions:
            return False
        self._state.message_reactions[key] = MessageReaction(
            message_id,
            user_id,
            reaction,
            created_at,
        )
        return True

    async def remove(self, *, message_id: UUID, user_id: UUID, reaction: str) -> bool:
        return self._state.message_reactions.pop((message_id, user_id, reaction), None) is not None


class FakeMessagePinRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def list_active(
        self,
        *,
        conversation_id: UUID,
        now: datetime,
    ) -> list[tuple[MessagePin, int]]:
        pins = []
        for pin in self._state.message_pins.values():
            message = self._state.messages.get(pin.message_id)
            if (
                pin.conversation_id == conversation_id
                and message is not None
                and message.conversation_id == conversation_id
                and not message.is_deleted
                and message.expires_at > now
            ):
                pins.append((pin, message.sequence))
        return sorted(
            pins,
            key=lambda item: (-item[0].pinned_at.timestamp(), item[0].message_id.int),
        )

    async def exists(self, *, conversation_id: UUID, message_id: UUID) -> bool:
        pin = self._state.message_pins.get(message_id)
        return pin is not None and pin.conversation_id == conversation_id

    async def count_active(self, *, conversation_id: UUID, now: datetime) -> int:
        return len(await self.list_active(conversation_id=conversation_id, now=now))

    async def add(self, pin: MessagePin) -> bool:
        if pin.message_id in self._state.message_pins:
            return False
        self._state.message_pins[pin.message_id] = pin
        return True

    async def remove(self, *, conversation_id: UUID, message_id: UUID) -> bool:
        pin = self._state.message_pins.get(message_id)
        if pin is None or pin.conversation_id != conversation_id:
            return False
        del self._state.message_pins[message_id]
        return True


class FakeSyncRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def append(self, events: list[PendingSyncEvent]) -> None:
        ordered_events = [
            event
            for user_id in sorted({item.user_id for item in events}, key=lambda value: value.int)
            for event in events
            if event.user_id == user_id
        ]
        for event in ordered_events:
            cursor = self._state.sync_cursors.get(event.user_id, 0) + 1
            self._state.sync_cursors[event.user_id] = cursor
            self._state.sync_events.append(
                SyncEvent(
                    event_id=event.event_id,
                    user_id=event.user_id,
                    cursor=cursor,
                    event_type=event.event_type,
                    conversation_id=event.conversation_id,
                    message_id=event.message_id,
                    actor_user_id=event.actor_user_id,
                    read_sequence=event.read_sequence,
                    delivery_sequence=event.delivery_sequence,
                    created_at=event.created_at,
                    expires_at=event.expires_at,
                )
            )

    async def list_after(
        self,
        *,
        user_id: UUID,
        after_cursor: int,
        limit: int,
    ) -> SyncStreamPage:
        matching = sorted(
            (
                event
                for event in self._state.sync_events
                if event.user_id == user_id and event.cursor > after_cursor
            ),
            key=lambda event: event.cursor,
        )[:limit]
        existing = [event.cursor for event in self._state.sync_events if event.user_id == user_id]
        return SyncStreamPage(
            events=tuple(matching),
            stream_cursor=self._state.sync_cursors.get(user_id, 0),
            oldest_cursor=min(existing, default=None),
        )

    async def prune_expired(self, now: datetime) -> None:
        self._state.sync_events = [
            event for event in self._state.sync_events if event.expires_at > now
        ]


class FakeMessagingUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.messages: MessageRepository = FakeMessageRepository(state)
        self.reactions: MessageReactionRepository = FakeMessageReactionRepository(state)
        self.pins: MessagePinRepository = FakeMessagePinRepository(state)
        self.attachments: AttachmentRepository = FakeAttachmentRepository(state)
        self.delivery_states: ConversationDeliveryStateRepository = (
            FakeConversationDeliveryStateRepository(state)
        )
        self.read_states: ConversationReadStateRepository = FakeConversationReadStateRepository(
            state
        )
        self.conversations: ConversationRepository = FakeConversationRepository(state)
        self.users: UserRepository = FakeUserRepository(state)
        self.devices: DeviceRepository = FakeDeviceRepository(state)
        self.sync_events: SyncRepository = FakeSyncRepository(state)
        self.crypto_generations: ConversationCryptoGenerationRepository = (
            FakeConversationCryptoGenerationRepository(state)
        )
        self.crypto_required_devices: ConversationCryptoRequiredDeviceRepository = (
            FakeConversationCryptoRequiredDeviceRepository(state)
        )
        self.crypto_identities: DeviceCryptoIdentityRepository = FakeDeviceCryptoIdentityRepository(
            state
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    async def commit(self) -> None:
        self._state.commits += 1


class FakeMessagingUnitOfWorkFactory:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    def __call__(self) -> MessagingUnitOfWork:
        return FakeMessagingUnitOfWork(self._state)


class FakeAttachmentUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.attachments: AttachmentRepository = FakeAttachmentRepository(state)
        self.conversations: ConversationRepository = FakeConversationRepository(state)
        self.users: UserRepository = FakeUserRepository(state)
        self.devices: DeviceRepository = FakeDeviceRepository(state)
        self.messages: MessageRepository = FakeMessageRepository(state)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    async def commit(self) -> None:
        self._state.commits += 1


class FakeAttachmentUnitOfWorkFactory:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    def __call__(self) -> AttachmentUnitOfWork:
        return FakeAttachmentUnitOfWork(self._state)


class FakeSyncUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.users: UserRepository = FakeUserRepository(state)
        self.sync_events: SyncRepository = FakeSyncRepository(state)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback

    async def commit(self) -> None:
        self._state.commits += 1


class FakeSyncUnitOfWorkFactory:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    def __call__(self) -> SyncUnitOfWork:
        return FakeSyncUnitOfWork(self._state)


@dataclass(frozen=True, slots=True)
class FixedClock:
    instant: datetime

    def now(self) -> datetime:
        return self.instant


class FixedActivationSecrets:
    def __init__(self, plaintext: str, digest: str) -> None:
        self._generated = GeneratedActivationSecret(plaintext=plaintext, digest=digest)

    def generate(self) -> GeneratedActivationSecret:
        return self._generated

    def digest(self, plaintext: str) -> str:
        del plaintext
        return self._generated.digest


class FixedPasswordResetSecrets:
    def __init__(self, plaintext: str, digest: str) -> None:
        self._generated = GeneratedPasswordResetSecret(plaintext=plaintext, digest=digest)

    def generate(self) -> GeneratedPasswordResetSecret:
        return self._generated

    def digest(self, plaintext: str) -> str:
        return hashlib.sha256(plaintext.encode()).hexdigest()


class SequentialActivationSecrets:
    """Deterministic unique credentials for reissue specifications."""

    def __init__(self) -> None:
        self.generated_plaintexts: list[str] = []

    def generate(self) -> GeneratedActivationSecret:
        sequence = len(self.generated_plaintexts) + 1
        plaintext = f"activation-secret-{sequence:032d}"
        self.generated_plaintexts.append(plaintext)
        return GeneratedActivationSecret(
            plaintext=plaintext,
            digest=self.digest(plaintext),
        )

    def digest(self, plaintext: str) -> str:
        return hashlib.sha256(plaintext.encode()).hexdigest()


class FixedSessionCredentials:
    def __init__(self) -> None:
        self.generated_plaintexts: list[str] = []

    def generate(self) -> GeneratedSessionCredential:
        plaintext = f"opaque-session-{len(self.generated_plaintexts) + 1:020d}"
        self.generated_plaintexts.append(plaintext)
        return GeneratedSessionCredential(
            plaintext=plaintext,
            digest=self.digest(plaintext),
        )

    def digest(self, plaintext: str) -> str:
        return hashlib.sha256(plaintext.encode()).hexdigest()


class FakePasswordHasher:
    def __init__(self) -> None:
        self.hashed_passwords: list[str] = []

    async def hash(self, password: str) -> str:
        self.hashed_passwords.append(password)
        return "$argon2id$fake-hash"

    async def verify(self, password_hash: str | None, password: str) -> bool:
        return (
            password_hash == "$argon2id$fake-hash"
            and bool(self.hashed_passwords)
            and password == self.hashed_passwords[-1]
        )
