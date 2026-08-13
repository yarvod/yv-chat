"""SQLAlchemy device-pairing repository."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from messenger.domain.entities import DevicePairing
from messenger.infrastructure.persistence.models import DevicePairingModel
from messenger.infrastructure.persistence.repositories.mappers import map_device_pairing


class SqlAlchemyDevicePairingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, pairing: DevicePairing) -> None:
        self._session.add(self._to_model(pairing))
        await self._session.flush()

    async def get_by_id_for_update(self, pairing_id: UUID) -> DevicePairing | None:
        model = await self._session.scalar(
            select(DevicePairingModel).where(DevicePairingModel.id == pairing_id).with_for_update()
        )
        return map_device_pairing(model) if model is not None else None

    async def update(self, pairing: DevicePairing) -> None:
        model = await self._session.get(DevicePairingModel, pairing.id)
        if model is None:
            raise RuntimeError("locked device pairing disappeared")
        model.status = pairing.status.value
        model.candidate_proof_hash = pairing.candidate_proof_hash
        model.candidate_device_name = pairing.candidate_device_name
        model.user_id = pairing.user_id
        model.trusted_session_id = pairing.trusted_session_id
        model.trusted_device_id = pairing.trusted_device_id
        model.authorized_session_id = pairing.authorized_session_id
        model.authorized_device_id = pairing.authorized_device_id
        model.scanned_at = pairing.scanned_at
        model.approved_at = pairing.approved_at
        model.authorized_at = pairing.authorized_at
        model.cancelled_at = pairing.cancelled_at
        model.expired_at = pairing.expired_at
        await self._session.flush()

    async def prune_expired(self, *, before: datetime) -> None:
        await self._session.execute(
            delete(DevicePairingModel).where(DevicePairingModel.expires_at <= before)
        )
        await self._session.flush()

    @staticmethod
    def _to_model(pairing: DevicePairing) -> DevicePairingModel:
        return DevicePairingModel(
            id=pairing.id,
            protocol_version=pairing.protocol_version,
            purpose=pairing.purpose.value,
            status=pairing.status.value,
            scan_token_hash=pairing.scan_token_hash,
            candidate_proof_hash=pairing.candidate_proof_hash,
            candidate_device_name=pairing.candidate_device_name,
            user_id=pairing.user_id,
            trusted_session_id=pairing.trusted_session_id,
            trusted_device_id=pairing.trusted_device_id,
            authorized_session_id=pairing.authorized_session_id,
            authorized_device_id=pairing.authorized_device_id,
            created_at=pairing.created_at,
            expires_at=pairing.expires_at,
            scanned_at=pairing.scanned_at,
            approved_at=pairing.approved_at,
            authorized_at=pairing.authorized_at,
            cancelled_at=pairing.cancelled_at,
            expired_at=pairing.expired_at,
        )
