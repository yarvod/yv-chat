"""Pure ORM-to-domain mapping functions."""

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
    return ActivationToken(
        id=model.id,
        user_id=model.user_id,
        token_hash=model.token_hash,
        expires_at=model.expires_at,
        created_at=model.created_at,
        used_at=model.used_at,
    )


def map_device(model: DeviceModel) -> Device:
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
    return SecurityEvent(
        id=model.id,
        user_id=model.user_id,
        event_type=SecurityEventType(model.event_type),
        created_at=model.created_at,
        expires_at=model.expires_at,
        actor_session_id=model.actor_session_id,
        target_device_id=model.target_device_id,
    )
