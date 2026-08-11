"""User repository port."""

from typing import Protocol
from uuid import UUID

from messenger.application.ports.identity.records import ManagedUserRecord, UserAuthenticationRecord
from messenger.domain.entities import User


class UserRepository(Protocol):
    async def list_active(self) -> list[User]: ...

    async def list_managed(self) -> list[ManagedUserRecord]: ...

    async def get_managed_by_id(
        self,
        user_id: UUID,
        *,
        for_update: bool = False,
    ) -> ManagedUserRecord | None: ...

    async def get_by_id(self, user_id: UUID, *, for_update: bool = False) -> User | None: ...

    async def get_by_username(self, username: str) -> User | None: ...

    async def get_many_by_ids(self, user_ids: set[UUID]) -> list[User]: ...

    async def get_authentication_by_username(
        self,
        username: str,
    ) -> UserAuthenticationRecord | None: ...

    async def get_authentication_by_id(
        self,
        user_id: UUID,
        *,
        for_update: bool = False,
    ) -> UserAuthenticationRecord | None: ...

    async def lock_initial_bootstrap(self) -> None: ...

    async def has_any(self) -> bool: ...

    async def add_invited(self, user: User) -> None: ...

    async def add_active(self, user: User, password_hash: str) -> None: ...

    async def activate(self, user: User, password_hash: str) -> None: ...

    async def update(self, user: User) -> None: ...

    async def update_password(self, user: User, password_hash: str) -> None: ...
