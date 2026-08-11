"""SQLAlchemy user repository adapter."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.errors import DuplicateUsernameError
from messenger.application.ports.identity import ManagedUserRecord, UserAuthenticationRecord
from messenger.domain.entities import User
from messenger.infrastructure.persistence.models import UserModel
from messenger.infrastructure.persistence.repositories.mappers import map_user


class SqlAlchemyUserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_active(self) -> list[User]:
        models = (
            await self._session.scalars(
                select(UserModel)
                .where(UserModel.is_active.is_(True))
                .order_by(UserModel.username, UserModel.id)
            )
        ).all()
        return [map_user(model) for model in models]

    async def list_managed(self) -> list[ManagedUserRecord]:
        models = (
            await self._session.scalars(
                select(UserModel).order_by(UserModel.username, UserModel.id)
            )
        ).all()
        return [
            ManagedUserRecord(
                user=map_user(model),
                password_configured=model.password_hash is not None,
            )
            for model in models
        ]

    async def get_managed_by_id(
        self,
        user_id: UUID,
        *,
        for_update: bool = False,
    ) -> ManagedUserRecord | None:
        statement = select(UserModel).where(UserModel.id == user_id)
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        if model is None:
            return None
        return ManagedUserRecord(
            user=map_user(model),
            password_configured=model.password_hash is not None,
        )

    async def get_by_id(self, user_id: UUID, *, for_update: bool = False) -> User | None:
        statement = select(UserModel).where(UserModel.id == user_id)
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_user(model) if model is not None else None

    async def get_by_username(self, username: str) -> User | None:
        model = await self._session.scalar(
            select(UserModel).where(func.lower(UserModel.username) == username.lower())
        )
        return map_user(model) if model is not None else None

    async def get_many_by_ids(self, user_ids: set[UUID]) -> list[User]:
        if not user_ids:
            return []
        models = (
            await self._session.scalars(
                select(UserModel)
                .where(UserModel.id.in_(user_ids))
                .order_by(UserModel.username, UserModel.id)
            )
        ).all()
        return [map_user(model) for model in models]

    async def get_authentication_by_username(
        self,
        username: str,
    ) -> UserAuthenticationRecord | None:
        model = await self._session.scalar(
            select(UserModel)
            .where(func.lower(UserModel.username) == username.strip().lower())
            .with_for_update()
        )
        if model is None:
            return None
        return UserAuthenticationRecord(user=map_user(model), password_hash=model.password_hash)

    async def get_authentication_by_id(
        self,
        user_id: UUID,
        *,
        for_update: bool = False,
    ) -> UserAuthenticationRecord | None:
        statement = select(UserModel).where(UserModel.id == user_id)
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        if model is None:
            return None
        return UserAuthenticationRecord(user=map_user(model), password_hash=model.password_hash)

    async def lock_initial_bootstrap(self) -> None:
        await self._session.execute(select(func.pg_advisory_xact_lock(9_180_013)))

    async def has_any(self) -> bool:
        return (await self._session.scalar(select(UserModel.id).limit(1))) is not None

    async def add_invited(self, user: User) -> None:
        if user.is_active:
            raise ValueError("add_invited requires an inactive user")
        await self._add(user, password_hash=None)

    async def add_active(self, user: User, password_hash: str) -> None:
        if not user.is_active:
            raise ValueError("add_active requires an active user")
        await self._add(user, password_hash=password_hash)

    async def _add(self, user: User, *, password_hash: str | None) -> None:
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

    async def update(self, user: User) -> None:
        model = await self._session.get(UserModel, user.id)
        if model is None:
            raise RuntimeError("locked user disappeared during update")
        model.display_name = user.display_name
        model.is_active = user.is_active
        model.updated_at = user.updated_at
        await self._session.flush()

    async def update_password(self, user: User, password_hash: str) -> None:
        model = await self._session.get(UserModel, user.id)
        if model is None:
            raise RuntimeError("locked user disappeared during password update")
        model.password_hash = password_hash
        model.updated_at = user.updated_at
        await self._session.flush()
