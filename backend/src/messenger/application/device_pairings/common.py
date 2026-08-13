"""Shared typed projection and non-secret pairing checks."""

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.errors import (
    DevicePairingNotFoundError,
    DevicePairingProofError,
    DevicePairingStateError,
)
from messenger.application.ports.identity import IdentityUnitOfWork
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.domain.entities import DevicePairing, DevicePairingStatus
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class DevicePairingView:
    pairing_id: UUID
    protocol_version: int
    purpose: str
    status: str
    candidate_device_name: str | None
    trusted_device_name: str | None
    account_display_name: str | None
    authentication_code: str | None
    expires_at: datetime
    authorized_device_id: UUID | None
    trusted_device_id: UUID | None
    candidate_device_id: UUID | None


def pairing_authentication_code(pairing: DevicePairing) -> str | None:
    if pairing.candidate_proof_hash is not None:
        candidate_binding = bytes.fromhex(pairing.candidate_proof_hash)
    elif pairing.candidate_session_id is not None and pairing.candidate_device_id is not None:
        candidate_binding = pairing.candidate_session_id.bytes + pairing.candidate_device_id.bytes
    else:
        return None
    digest = hashlib.sha256(
        b"yv-chat-device-pairing-sas-v1\x00"
        + pairing.id.bytes
        + bytes.fromhex(pairing.scan_token_hash)
        + candidate_binding
    ).digest()
    return f"{int.from_bytes(digest[:4], 'big') % 1_000_000:06d}"


def verify_scan_token(
    pairing: DevicePairing,
    scan_token: str,
    credentials: SessionCredentialService,
) -> None:
    if not hmac.compare_digest(pairing.scan_token_hash, credentials.digest(scan_token)):
        raise DevicePairingProofError("invalid pairing capability")


def verify_candidate_proof(
    pairing: DevicePairing,
    candidate_proof: str,
    credentials: SessionCredentialService,
) -> None:
    expected = pairing.candidate_proof_hash
    if expected is None or not hmac.compare_digest(expected, credentials.digest(candidate_proof)):
        raise DevicePairingProofError("invalid candidate proof")


async def load_pairing_for_update(
    uow: IdentityUnitOfWork,
    pairing_id: UUID,
    now: datetime,
) -> DevicePairing:
    pairing = await uow.device_pairings.get_by_id_for_update(pairing_id)
    if pairing is None:
        raise DevicePairingNotFoundError("pairing not found")
    expired = pairing.expire(now)
    if expired != pairing:
        await uow.device_pairings.update(expired)
        pairing = expired
    return pairing


async def build_pairing_view(
    uow: IdentityUnitOfWork,
    pairing: DevicePairing,
) -> DevicePairingView:
    trusted_device_name: str | None = None
    candidate_device_name = pairing.candidate_device_name
    account_display_name: str | None = None
    if pairing.trusted_device_id is not None:
        trusted_device = await uow.devices.get_by_id(pairing.trusted_device_id)
        trusted_device_name = trusted_device.name if trusted_device is not None else None
    if pairing.candidate_device_id is not None:
        candidate_device = await uow.devices.get_by_id(pairing.candidate_device_id)
        candidate_device_name = candidate_device.name if candidate_device is not None else None
    if pairing.user_id is not None:
        user = await uow.users.get_by_id(pairing.user_id)
        account_display_name = user.display_name if user is not None else None
    return DevicePairingView(
        pairing_id=pairing.id,
        protocol_version=pairing.protocol_version,
        purpose=pairing.purpose.value,
        status=pairing.status.value,
        candidate_device_name=candidate_device_name,
        trusted_device_name=trusted_device_name,
        account_display_name=account_display_name,
        authentication_code=(
            pairing_authentication_code(pairing)
            if pairing.status
            in {
                DevicePairingStatus.CONFIRMATION_PENDING,
                DevicePairingStatus.APPROVED,
                DevicePairingStatus.AUTHORIZED,
            }
            else None
        ),
        expires_at=pairing.expires_at,
        authorized_device_id=pairing.authorized_device_id,
        trusted_device_id=pairing.trusted_device_id,
        candidate_device_id=pairing.candidate_device_id,
    )


async def require_active_trusted_session(
    uow: IdentityUnitOfWork,
    *,
    user_id: UUID,
    session_id: UUID,
    device_id: UUID,
    now: datetime,
) -> None:
    record = await uow.sessions.get_by_device_for_user_for_update(
        user_id=user_id,
        device_id=device_id,
    )
    user = await uow.users.get_by_id(user_id)
    if (
        record is None
        or record.session.id != session_id
        or record.session.revoked_at is not None
        or record.session.is_expired(now)
        or record.device.revoked_at is not None
        or user is None
        or not user.is_active
    ):
        raise DevicePairingNotFoundError("trusted session is not active")


def require_trusted_actor(
    pairing: DevicePairing,
    *,
    user_id: UUID,
    session_id: UUID,
    device_id: UUID,
) -> None:
    if (
        pairing.user_id != user_id
        or pairing.trusted_session_id != session_id
        or pairing.trusted_device_id != device_id
    ):
        raise DevicePairingNotFoundError("pairing not found")


def require_existing_candidate_actor(
    pairing: DevicePairing,
    *,
    user_id: UUID,
    session_id: UUID,
    device_id: UUID,
) -> None:
    if (
        pairing.user_id != user_id
        or pairing.candidate_session_id != session_id
        or pairing.candidate_device_id != device_id
    ):
        raise DevicePairingNotFoundError("pairing not found")


def translate_transition_error(error: DomainValidationError) -> DevicePairingStateError:
    return DevicePairingStateError("pairing state conflict")
