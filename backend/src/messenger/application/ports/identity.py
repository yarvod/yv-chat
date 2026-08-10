"""Persistence ports for account invitation and activation."""

from types import TracebackType
from typing import Protocol, Self
from uuid import UUID

from messenger.domain.entities import ActivationToken, User


class UserRepository(Protocol):
    """User operations needed by identity use cases."""

    async def get_by_id(self, user_id: UUID, *, for_update: bool = False) -> User | None:
        """Load one user, optionally locking its row."""
        ...

    async def get_by_username(self, username: str) -> User | None:
        """Load by normalized case-insensitive username."""
        ...

    async def lock_initial_bootstrap(self) -> None:
        """Serialize the one-time initial admin decision."""
        ...

    async def has_any(self) -> bool:
        """Report whether bootstrap must remain closed."""
        ...

    async def add_invited(self, user: User) -> None:
        """Persist a new inactive user or raise DuplicateUsernameError."""
        ...

    async def add_active(self, user: User, password_hash: str) -> None:
        """Persist an active bootstrap account with its password hash."""
        ...

    async def activate(self, user: User, password_hash: str) -> None:
        """Persist activation state and password hash atomically."""
        ...


class ActivationTokenRepository(Protocol):
    """One-time activation credential operations."""

    async def add(self, token: ActivationToken) -> None:
        """Persist a hashed activation token."""
        ...

    async def get_by_hash_for_update(self, token_hash: str) -> ActivationToken | None:
        """Lock a credential so concurrent activation is serialized."""
        ...

    async def mark_used(self, token: ActivationToken) -> None:
        """Persist the consumed timestamp."""
        ...


class IdentityUnitOfWork(Protocol):
    """One transaction containing identity repositories."""

    users: UserRepository
    activation_tokens: ActivationTokenRepository

    async def __aenter__(self) -> Self:
        """Open the transaction scope."""
        ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Rollback uncommitted work and release resources."""
        ...

    async def commit(self) -> None:
        """Commit all changes in the application operation."""
        ...


class IdentityUnitOfWorkFactory(Protocol):
    """Create an independent unit of work per operation."""

    def __call__(self) -> IdentityUnitOfWork:
        """Return a fresh unit of work."""
        ...
