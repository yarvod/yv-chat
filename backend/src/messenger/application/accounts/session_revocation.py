"""Shared current-account session validation and revocation policy."""

from datetime import datetime
from uuid import UUID

from messenger.application.errors import SessionNotAuthenticatedError
from messenger.application.ports.identity import DeviceSessionRecord, IdentityUnitOfWork


def require_current_session(
    records: list[DeviceSessionRecord],
    *,
    current_session_id: UUID,
    now: datetime,
) -> None:
    current = next(
        (record for record in records if record.session.id == current_session_id),
        None,
    )
    if (
        current is None
        or current.session.revoked_at is not None
        or current.device.revoked_at is not None
        or current.session.is_expired(now)
    ):
        raise SessionNotAuthenticatedError("current session is not authenticated")


async def revoke_sessions(
    unit_of_work: IdentityUnitOfWork,
    records: list[DeviceSessionRecord],
    *,
    now: datetime,
    keep_session_id: UUID | None,
) -> int:
    revoked_count = 0
    for record in records:
        if record.session.id == keep_session_id:
            continue
        if record.session.revoked_at is None:
            await unit_of_work.sessions.update(record.session.revoke(now))
            revoked_count += 1
        if record.device.revoked_at is None:
            await unit_of_work.devices.update(record.device.revoke(now))
    return revoked_count
