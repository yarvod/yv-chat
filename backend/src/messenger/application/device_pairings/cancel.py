"""Cancel an unfinished pairing from either bound side."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_pairings.common import (
    DevicePairingView,
    build_pairing_view,
    load_pairing_for_update,
    require_active_trusted_session,
    require_existing_candidate_actor,
    require_trusted_actor,
    verify_candidate_proof,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService


@dataclass(frozen=True, slots=True)
class CancelCandidatePairingCommand:
    pairing_id: UUID
    candidate_proof: str


@dataclass(frozen=True, slots=True)
class CancelTrustedPairingCommand:
    pairing_id: UUID
    user_id: UUID
    session_id: UUID
    device_id: UUID


@dataclass(frozen=True, slots=True)
class CancelExistingCandidatePairingCommand:
    pairing_id: UUID
    user_id: UUID
    session_id: UUID
    device_id: UUID


class CancelCandidatePairing:
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

    async def execute(self, command: CancelCandidatePairingCommand) -> DevicePairingView:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            pairing = await load_pairing_for_update(uow, command.pairing_id, now)
            verify_candidate_proof(pairing, command.candidate_proof, self._credentials)
            cancelled = pairing.cancel(now=now)
            if cancelled != pairing:
                await uow.device_pairings.update(cancelled)
            view = await build_pairing_view(uow, cancelled)
            await uow.commit()
            return view


class CancelTrustedPairing:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: CancelTrustedPairingCommand) -> DevicePairingView:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            await require_active_trusted_session(
                uow,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
                now=now,
            )
            pairing = await load_pairing_for_update(uow, command.pairing_id, now)
            require_trusted_actor(
                pairing,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
            )
            cancelled = pairing.cancel(now=now)
            if cancelled != pairing:
                await uow.device_pairings.update(cancelled)
            view = await build_pairing_view(uow, cancelled)
            await uow.commit()
            return view


class CancelExistingCandidatePairing:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(
        self,
        command: CancelExistingCandidatePairingCommand,
    ) -> DevicePairingView:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            await require_active_trusted_session(
                uow,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
                now=now,
            )
            pairing = await load_pairing_for_update(uow, command.pairing_id, now)
            require_existing_candidate_actor(
                pairing,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
            )
            cancelled = pairing.cancel(now=now)
            if cancelled != pairing:
                await uow.device_pairings.update(cancelled)
            view = await build_pairing_view(uow, cancelled)
            await uow.commit()
            return view
