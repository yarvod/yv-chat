"""In-memory identity adapters for application specifications."""

from dataclasses import dataclass, field
from datetime import datetime
from types import TracebackType
from typing import Self
from uuid import UUID

from messenger.application.errors import DuplicateUsernameError
from messenger.application.ports.activation_secrets import GeneratedActivationSecret
from messenger.application.ports.identity import (
    ActivationTokenRepository,
    IdentityUnitOfWork,
    UserRepository,
)
from messenger.domain.entities import ActivationToken, User


@dataclass(slots=True)
class IdentityState:
    """Shared state across fresh fake units of work."""

    users: dict[UUID, User] = field(default_factory=dict)
    tokens: dict[UUID, ActivationToken] = field(default_factory=dict)
    password_hashes: dict[UUID, str] = field(default_factory=dict)
    commits: int = 0


class FakeUserRepository:
    def __init__(self, state: IdentityState) -> None:
        self._state = state

    async def get_by_id(self, user_id: UUID, *, for_update: bool = False) -> User | None:
        del for_update
        return self._state.users.get(user_id)

    async def get_by_username(self, username: str) -> User | None:
        normalized = username.lower()
        return next(
            (user for user in self._state.users.values() if user.username == normalized),
            None,
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

    async def mark_used(self, token: ActivationToken) -> None:
        self._state.tokens[token.id] = token


class FakeIdentityUnitOfWork:
    def __init__(self, state: IdentityState) -> None:
        self._state = state
        self.users: UserRepository = FakeUserRepository(state)
        self.activation_tokens: ActivationTokenRepository = FakeActivationTokenRepository(state)

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


class FakePasswordHasher:
    def __init__(self) -> None:
        self.hashed_passwords: list[str] = []

    async def hash(self, password: str) -> str:
        self.hashed_passwords.append(password)
        return "$argon2id$fake-hash"

    async def verify(self, password_hash: str, password: str) -> bool:
        return password_hash == "$argon2id$fake-hash" and password in self.hashed_passwords
