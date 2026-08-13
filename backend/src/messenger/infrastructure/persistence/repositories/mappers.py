"""Pure ORM-to-domain mapping functions."""

from messenger.domain.entities import (
    ActivationToken,
    Device,
    DeviceCryptoIdentity,
    DeviceKeyPackage,
    DevicePairing,
    DevicePairingPurpose,
    DevicePairingStatus,
    PasswordResetToken,
    RegistrationInvitation,
    SecurityEvent,
    SecurityEventType,
    Session,
    User,
)
from messenger.infrastructure.persistence.models import (
    ActivationTokenModel,
    DeviceCryptoIdentityModel,
    DeviceKeyPackageModel,
    DeviceModel,
    DevicePairingModel,
    PasswordResetTokenModel,
    RegistrationInvitationModel,
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
        revoked_at=model.revoked_at,
    )


def map_password_reset_token(model: PasswordResetTokenModel) -> PasswordResetToken:
    return PasswordResetToken(
        id=model.id,
        user_id=model.user_id,
        token_hash=model.token_hash,
        expires_at=model.expires_at,
        created_at=model.created_at,
        used_at=model.used_at,
        revoked_at=model.revoked_at,
    )


def map_registration_invitation(
    model: RegistrationInvitationModel,
) -> RegistrationInvitation:
    return RegistrationInvitation(
        id=model.id,
        token_hash=model.token_hash,
        label=model.label,
        created_by_user_id=model.created_by_user_id,
        registered_user_id=model.registered_user_id,
        created_at=model.created_at,
        expires_at=model.expires_at,
        used_at=model.used_at,
        revoked_at=model.revoked_at,
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


def map_device_pairing(model: DevicePairingModel) -> DevicePairing:
    return DevicePairing(
        id=model.id,
        protocol_version=model.protocol_version,
        purpose=DevicePairingPurpose(model.purpose),
        status=DevicePairingStatus(model.status),
        scan_token_hash=model.scan_token_hash,
        candidate_proof_hash=model.candidate_proof_hash,
        candidate_device_name=model.candidate_device_name,
        candidate_session_id=model.candidate_session_id,
        candidate_device_id=model.candidate_device_id,
        user_id=model.user_id,
        trusted_session_id=model.trusted_session_id,
        trusted_device_id=model.trusted_device_id,
        authorized_session_id=model.authorized_session_id,
        authorized_device_id=model.authorized_device_id,
        created_at=model.created_at,
        expires_at=model.expires_at,
        scanned_at=model.scanned_at,
        approved_at=model.approved_at,
        authorized_at=model.authorized_at,
        cancelled_at=model.cancelled_at,
        expired_at=model.expired_at,
        history_sync_cancelled_at=model.history_sync_cancelled_at,
    )


def map_device_crypto_identity(model: DeviceCryptoIdentityModel) -> DeviceCryptoIdentity:
    return DeviceCryptoIdentity(
        device_id=model.device_id,
        user_id=model.user_id,
        protocol_version=model.protocol_version,
        credential_identity=model.credential_identity,
        signature_public_key=model.signature_public_key,
        fingerprint=model.fingerprint,
        created_at=model.created_at,
    )


def map_device_key_package(model: DeviceKeyPackageModel) -> DeviceKeyPackage:
    return DeviceKeyPackage(
        id=model.id,
        device_id=model.device_id,
        user_id=model.user_id,
        package_ref=model.package_ref,
        key_package=model.key_package,
        created_at=model.created_at,
        claimed_at=model.claimed_at,
        claimed_by_user_id=model.claimed_by_user_id,
        claimed_by_device_id=model.claimed_by_device_id,
        claim_conversation_id=model.claim_conversation_id,
        claim_request_id=model.claim_request_id,
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
