"""Read pairing progress through candidate-proof or trusted-session boundaries."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_pairings.common import (
    DevicePairingView,
    build_pairing_view,
    load_pairing_for_update,
    require_active_trusted_session,
    require_trusted_actor,
    verify_candidate_proof,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService


@dataclass(frozen=True, slots=True)
class GetCandidatePairingStatusQuery:
    pairing_id: UUID
    candidate_proof: str


@dataclass(frozen=True, slots=True)
class GetTrustedPairingStatusQuery:
    pairing_id: UUID
    user_id: UUID
    session_id: UUID
    device_id: UUID


class GetCandidatePairingStatus:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        credentials: SessionCredentialService,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._credentials = credentials

    async def execute(self, query: GetCandidatePairingStatusQuery) -> DevicePairingView:
        async with self._unit_of_work() as uow:
            pairing = await load_pairing_for_update(uow, query.pairing_id, self._clock.now())
            verify_candidate_proof(pairing, query.candidate_proof, self._credentials)
            view = await build_pairing_view(uow, pairing)
            await uow.commit()
            return view


class GetTrustedPairingStatus:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, query: GetTrustedPairingStatusQuery) -> DevicePairingView:
        async with self._unit_of_work() as uow:
            await require_active_trusted_session(
                uow,
                user_id=query.user_id,
                session_id=query.session_id,
                device_id=query.device_id,
                now=self._clock.now(),
            )
            pairing = await load_pairing_for_update(uow, query.pairing_id, self._clock.now())
            require_trusted_actor(
                pairing,
                user_id=query.user_id,
                session_id=query.session_id,
                device_id=query.device_id,
            )
            view = await build_pairing_view(uow, pairing)
            await uow.commit()
            return view
