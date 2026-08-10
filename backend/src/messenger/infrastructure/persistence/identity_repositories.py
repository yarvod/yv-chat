"""SQLAlchemy repositories for identity use cases."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.application.errors import DuplicateUsernameError
from messenger.application.ports.identity import (
    DeviceSessionRecord,
    SessionCredentialMatch,
    UserAuthenticationRecord,
)
from messenger.domain.entities import (
    ActivationToken,
    Device,
    SecurityEvent,
    SecurityEventType,
    Session,
    User,
)
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    DeviceModel,
    SecurityEventModel,
    SessionModel,
    UserModel,
)


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


def map_device(model: DeviceModel) -> Device:
    """Map device ownership and non-authoritative metadata."""
    return Device(
        id=model.id,
        user_id=model.user_id,
        name=model.name,
        created_at=model.created_at,
        last_seen_at=model.last_seen_at,
        revoked_at=model.revoked_at,
        login_ip=model.login_ip,
        last_ip=model.last_ip,
    )


def map_session(model: SessionModel) -> Session:
    """Map hashed credential state without exposing ORM objects."""
    return Session(
        id=model.id,
        user_id=model.user_id,
        device_id=model.device_id,
        current_token_hash=model.current_token_hash,
        previous_token_hash=model.previous_token_hash,
        previous_token_expires_at=model.previous_token_expires_at,
        created_at=model.created_at,
        last_seen_at=model.last_seen_at,
        idle_expires_at=model.idle_expires_at,
        absolute_expires_at=model.absolute_expires_at,
        rotated_at=model.rotated_at,
        revoked_at=model.revoked_at,
    )


def map_security_event(model: SecurityEventModel) -> SecurityEvent:
    """Map only typed identifiers and timestamps; there is no free-form payload."""
    return SecurityEvent(
        id=model.id,
        user_id=model.user_id,
        event_type=SecurityEventType(model.event_type),
        created_at=model.created_at,
        expires_at=model.expires_at,
        actor_session_id=model.actor_session_id,
        target_device_id=model.target_device_id,
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

    async def get_authentication_by_username(
        self,
        username: str,
    ) -> UserAuthenticationRecord | None:
        statement = (
            select(UserModel)
            .where(func.lower(UserModel.username) == username.strip().lower())
            .with_for_update()
        )
        model = await self._session.scalar(statement)
        if model is None:
            return None
        return UserAuthenticationRecord(
            user=map_user(model),
            password_hash=model.password_hash,
        )

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


class SqlAlchemyDeviceRepository:
    """Device persistence for enrollment and throttled metadata updates."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, device_id: UUID, *, for_update: bool = False) -> Device | None:
        statement = select(DeviceModel).where(DeviceModel.id == device_id)
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_device(model) if model is not None else None

    async def get_owned_by_id(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
        for_update: bool = False,
    ) -> Device | None:
        statement = select(DeviceModel).where(
            DeviceModel.id == device_id,
            DeviceModel.user_id == user_id,
        )
        if for_update:
            statement = statement.with_for_update()
        model = await self._session.scalar(statement)
        return map_device(model) if model is not None else None

    async def add(self, device: Device) -> None:
        self._session.add(
            DeviceModel(
                id=device.id,
                user_id=device.user_id,
                name=device.name,
                created_at=device.created_at,
                last_seen_at=device.last_seen_at,
                revoked_at=device.revoked_at,
                login_ip=device.login_ip,
                last_ip=device.last_ip,
            )
        )
        await self._session.flush()

    async def update(self, device: Device) -> None:
        model = await self._session.get(DeviceModel, device.id)
        if model is None:
            raise RuntimeError("locked device disappeared during session update")
        model.name = device.name
        model.last_seen_at = device.last_seen_at
        model.revoked_at = device.revoked_at
        model.last_ip = device.last_ip
        await self._session.flush()


class SqlAlchemySessionRepository:
    """Row-locked hashed session credential persistence."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, session: Session) -> None:
        self._session.add(
            SessionModel(
                id=session.id,
                user_id=session.user_id,
                device_id=session.device_id,
                current_token_hash=session.current_token_hash,
                previous_token_hash=session.previous_token_hash,
                previous_token_expires_at=session.previous_token_expires_at,
                created_at=session.created_at,
                last_seen_at=session.last_seen_at,
                idle_expires_at=session.idle_expires_at,
                absolute_expires_at=session.absolute_expires_at,
                rotated_at=session.rotated_at,
                revoked_at=session.revoked_at,
            )
        )
        await self._session.flush()

    async def get_by_token_hash_for_update(
        self,
        token_hash: str,
    ) -> SessionCredentialMatch | None:
        statement = (
            select(SessionModel)
            .where(
                or_(
                    SessionModel.current_token_hash == token_hash,
                    SessionModel.previous_token_hash == token_hash,
                )
            )
            .with_for_update()
        )
        model = await self._session.scalar(statement)
        if model is None:
            return None
        return SessionCredentialMatch(
            session=map_session(model),
            matched_previous=model.previous_token_hash == token_hash,
        )

    async def update(self, session: Session) -> None:
        model = await self._session.get(SessionModel, session.id)
        if model is None:
            raise RuntimeError("locked session disappeared during update")
        model.current_token_hash = session.current_token_hash
        model.previous_token_hash = session.previous_token_hash
        model.previous_token_expires_at = session.previous_token_expires_at
        model.last_seen_at = session.last_seen_at
        model.idle_expires_at = session.idle_expires_at
        model.rotated_at = session.rotated_at
        model.revoked_at = session.revoked_at
        await self._session.flush()

    async def list_active_with_devices(
        self,
        *,
        user_id: UUID,
        now: datetime,
    ) -> list[DeviceSessionRecord]:
        statement = (
            select(SessionModel, DeviceModel)
            .join(DeviceModel, DeviceModel.id == SessionModel.device_id)
            .where(
                SessionModel.user_id == user_id,
                SessionModel.revoked_at.is_(None),
                SessionModel.idle_expires_at > now,
                SessionModel.absolute_expires_at > now,
                DeviceModel.revoked_at.is_(None),
            )
            .order_by(SessionModel.last_seen_at.desc(), SessionModel.id)
        )
        rows = (await self._session.execute(statement)).all()
        return [
            DeviceSessionRecord(device=map_device(device), session=map_session(session))
            for session, device in rows
        ]

    async def get_by_device_for_user_for_update(
        self,
        *,
        user_id: UUID,
        device_id: UUID,
    ) -> DeviceSessionRecord | None:
        statement = (
            select(SessionModel, DeviceModel)
            .join(DeviceModel, DeviceModel.id == SessionModel.device_id)
            .where(
                SessionModel.user_id == user_id,
                SessionModel.device_id == device_id,
                DeviceModel.user_id == user_id,
            )
            .with_for_update()
        )
        row = (await self._session.execute(statement)).one_or_none()
        if row is None:
            return None
        session, device = row
        return DeviceSessionRecord(device=map_device(device), session=map_session(session))

    async def list_for_user_for_update(self, user_id: UUID) -> list[DeviceSessionRecord]:
        statement = (
            select(SessionModel, DeviceModel)
            .join(DeviceModel, DeviceModel.id == SessionModel.device_id)
            .where(SessionModel.user_id == user_id, DeviceModel.user_id == user_id)
            .order_by(SessionModel.id)
            .with_for_update()
        )
        rows = (await self._session.execute(statement)).all()
        return [
            DeviceSessionRecord(device=map_device(device), session=map_session(session))
            for session, device in rows
        ]


class SqlAlchemySecurityEventRepository:
    """Typed event persistence with retention pruning and user-scoped reads."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, event: SecurityEvent) -> None:
        self._session.add(
            SecurityEventModel(
                id=event.id,
                user_id=event.user_id,
                event_type=event.event_type.value,
                created_at=event.created_at,
                expires_at=event.expires_at,
                actor_session_id=event.actor_session_id,
                target_device_id=event.target_device_id,
            )
        )
        await self._session.flush()

    async def list_recent(
        self,
        *,
        user_id: UUID,
        now: datetime,
        limit: int,
    ) -> list[SecurityEvent]:
        statement = (
            select(SecurityEventModel)
            .where(
                SecurityEventModel.user_id == user_id,
                SecurityEventModel.expires_at > now,
            )
            .order_by(SecurityEventModel.created_at.desc(), SecurityEventModel.id.desc())
            .limit(limit)
        )
        models = (await self._session.scalars(statement)).all()
        return [map_security_event(model) for model in models]

    async def prune_expired(self, now: datetime) -> None:
        await self._session.execute(
            delete(SecurityEventModel).where(SecurityEventModel.expires_at <= now)
        )
