"""SQLAlchemy repositories for identity use cases."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.errors import DuplicateUsernameError
from messenger.domain.entities import ActivationToken, User
from messenger.infrastructure.persistence.models import ActivationTokenModel, UserModel


def map_user(model: UserModel) -> User:
    """Map persistence state to the domain entity."""
    return User(
        id=model.id,
        username=model.username,
        display_name=model.display_name,
        is_admin=model.is_admin,
        is_active=model.is_active,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def map_activation_token(model: ActivationTokenModel) -> ActivationToken:
    """Map only the hashed credential into the domain."""
    return ActivationToken(
        id=model.id,
        user_id=model.user_id,
        token_hash=model.token_hash,
        expires_at=model.expires_at,
        created_at=model.created_at,
        used_at=model.used_at,
    )


class SqlAlchemyUserRepository:
    """Identity-specific user persistence operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: UUID, *, for_update: bool = False) -> User | None:
        statement = select(UserModel).where(UserModel.id == user_id)
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_user(model) if model is not None else None

    async def get_by_username(self, username: str) -> User | None:
        statement = select(UserModel).where(func.lower(UserModel.username) == username.lower())
        model = await self._session.scalar(statement)
        return map_user(model) if model is not None else None

    async def lock_initial_bootstrap(self) -> None:
        await self._session.execute(select(func.pg_advisory_xact_lock(9_180_013)))

    async def has_any(self) -> bool:
        return (await self._session.scalar(select(UserModel.id).limit(1))) is not None

    async def add_invited(self, user: User) -> None:
        if user.is_active:
            raise ValueError("add_invited requires an inactive user")
        self._session.add(
            UserModel(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                password_hash=None,
                is_admin=user.is_admin,
                is_active=user.is_active,
                created_at=user.created_at,
                updated_at=user.updated_at,
            )
        )
        try:
            await self._session.flush()
        except IntegrityError as error:
            raise DuplicateUsernameError("username is already in use") from error

    async def add_active(self, user: User, password_hash: str) -> None:
        if not user.is_active:
            raise ValueError("add_active requires an active user")
        self._session.add(
            UserModel(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                password_hash=password_hash,
                is_admin=user.is_admin,
                is_active=user.is_active,
                created_at=user.created_at,
                updated_at=user.updated_at,
            )
        )
        try:
            await self._session.flush()
        except IntegrityError as error:
            raise DuplicateUsernameError("username is already in use") from error

    async def activate(self, user: User, password_hash: str) -> None:
        if not user.is_active:
            raise ValueError("activate requires an active user")
        model = await self._session.get(UserModel, user.id)
        if model is None:
            raise RuntimeError("locked user disappeared during activation")
        model.password_hash = password_hash
        model.is_active = True
        model.updated_at = user.updated_at
        await self._session.flush()


class SqlAlchemyActivationTokenRepository:
    """One-time activation token persistence operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, token: ActivationToken) -> None:
        self._session.add(
            ActivationTokenModel(
                id=token.id,
                user_id=token.user_id,
                token_hash=token.token_hash,
                expires_at=token.expires_at,
                created_at=token.created_at,
                used_at=token.used_at,
            )
        )
        await self._session.flush()

    async def get_by_hash_for_update(self, token_hash: str) -> ActivationToken | None:
        statement = (
            select(ActivationTokenModel)
            .where(ActivationTokenModel.token_hash == token_hash)
            .with_for_update()
        )
        model = await self._session.scalar(statement)
        return map_activation_token(model) if model is not None else None

    async def mark_used(self, token: ActivationToken) -> None:
        model = await self._session.get(ActivationTokenModel, token.id)
        if model is None:
            raise RuntimeError("locked activation token disappeared")
        model.used_at = token.used_at
        await self._session.flush()
