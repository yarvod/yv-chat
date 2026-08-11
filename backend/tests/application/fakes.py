"""In-memory identity adapters for application specifications."""

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from types import TracebackType
from typing import Self
from uuid import UUID

from messenger.application.errors import DuplicateDirectConversationError, DuplicateUsernameError
from messenger.application.ports.activation_secrets import GeneratedActivationSecret
from messenger.application.ports.conversations import (
    ConversationRepository,
    ConversationUnitOfWork,
)
from messenger.application.ports.identity import (
    ActivationTokenRepository,
    DeviceRepository,
    DeviceSessionRecord,
    IdentityUnitOfWork,
    ManagedUserRecord,
    SecurityEventRepository,
    SessionCredentialMatch,
    SessionRepository,
    UserAuthenticationRecord,
    UserRepository,
)
from messenger.application.ports.messages import MessageRepository, MessagingUnitOfWork
from messenger.application.ports.session_credentials import GeneratedSessionCredential
from messenger.domain.entities import (
    ActivationToken,
    Conversation,
    Device,
    Message,
    SecurityEvent,
    Session,
    User,
)


@dataclass(slots=True)
class IdentityState:
    """Shared state across fresh fake units of work."""

    users: dict[UUID, User] = field(default_factory=dict)
    tokens: dict[UUID, ActivationToken] = field(default_factory=dict)
    password_hashes: dict[UUID, str] = field(default_factory=dict)
    devices: dict[UUID, Device] = field(default_factory=dict)
    sessions: dict[UUID, Session] = field(default_factory=dict)
    security_events: dict[UUID, SecurityEvent] = field(default_factory=dict)
    conversations: dict[UUID, Conversation] = field(default_factory=dict)
    messages: dict[UUID, Message] = field(default_factory=dict)
    commits: int = 0


class FakeUserRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def list_managed(self) -> list[ManagedUserRecord]:
        return [
            ManagedUserRecord(
                user=user,
                password_configured=user.id in self._state.password_hashes,
            )
            for user in sorted(
                self._state.users.values(),
                key=lambda item: (item.username, item.id),
            )
        ]

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

    async def add(self, device: Device) -> None:
        self._state.devices[device.id] = device

    async def update(self, device: Device) -> None:
        self._state.devices[device.id] = device


class FakeSessionRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def add(self, session: Session) -> None:
        self._state.sessions[session.id] = session

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
        self.devices: DeviceRepository = FakeDeviceRepository(state)
        self.sessions: SessionRepository = FakeSessionRepository(state)
        self.security_events: SecurityEventRepository = FakeSecurityEventRepository(state)

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


class FakeConversationUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.conversations: ConversationRepository = FakeConversationRepository(state)
        self.users: UserRepository = FakeUserRepository(state)

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


class FakeMessagingUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.messages: MessageRepository = FakeMessageRepository(state)
        self.conversations: ConversationRepository = FakeConversationRepository(state)
        self.users: UserRepository = FakeUserRepository(state)
        self.devices: DeviceRepository = FakeDeviceRepository(state)

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
        plaintext = f"opaque-session-{len(self.generated_plaintexts) + 1}"
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
        return password_hash == "$argon2id$fake-hash" and password in self.hashed_passwords
