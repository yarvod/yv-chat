"""SQLAlchemy device-pairing repository."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, delete, or_, select, text
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

    async def get_by_id(self, pairing_id: UUID) -> DevicePairing | None:
        model = await self._session.get(DevicePairingModel, pairing_id)
        return map_device_pairing(model) if model is not None else None

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
        model.candidate_session_id = pairing.candidate_session_id
        model.candidate_device_id = pairing.candidate_device_id
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
        model.history_sync_cancelled_at = pairing.history_sync_cancelled_at
        await self._session.flush()

    async def lock_history_pair(
        self,
        *,
        user_id: UUID,
        first_device_id: UUID,
        second_device_id: UUID,
    ) -> None:
        low, high = sorted((first_device_id, second_device_id), key=str)
        pair_key = f"{user_id}:{low}:{high}"
        await self._session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:pair_key, 0))"),
            {"pair_key": pair_key},
        )

    async def cancel_other_active_history_syncs(
        self,
        *,
        pairing_id: UUID,
        user_id: UUID,
        first_device_id: UUID,
        second_device_id: UUID,
        now: datetime,
    ) -> None:
        same_pair = or_(
            and_(
                DevicePairingModel.trusted_device_id == first_device_id,
                DevicePairingModel.authorized_device_id == second_device_id,
            ),
            and_(
                DevicePairingModel.trusted_device_id == second_device_id,
                DevicePairingModel.authorized_device_id == first_device_id,
            ),
        )
        models = list(
            await self._session.scalars(
                select(DevicePairingModel)
                .where(
                    DevicePairingModel.id != pairing_id,
                    DevicePairingModel.user_id == user_id,
                    DevicePairingModel.status == "authorized",
                    DevicePairingModel.history_sync_cancelled_at.is_(None),
                    same_pair,
                )
                .order_by(DevicePairingModel.id)
                .with_for_update()
            )
        )
        for model in models:
            model.history_sync_cancelled_at = now
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
            candidate_session_id=pairing.candidate_session_id,
            candidate_device_id=pairing.candidate_device_id,
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
            history_sync_cancelled_at=pairing.history_sync_cancelled_at,
        )
