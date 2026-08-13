"""Explicitly approve a scanned candidate from the bound trusted session."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_pairings.common import (
    DevicePairingView,
    build_pairing_view,
    load_pairing_for_update,
    require_active_trusted_session,
    require_trusted_actor,
    translate_transition_error,
)
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class ApproveDevicePairingCommand:
    pairing_id: UUID
    user_id: UUID
    session_id: UUID
    device_id: UUID


class ApproveDevicePairing:
    def __init__(self, *, unit_of_work: IdentityUnitOfWorkFactory, clock: Clock) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def execute(self, command: ApproveDevicePairingCommand) -> DevicePairingView:
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
            if pairing.candidate_session_id is not None and pairing.candidate_device_id is not None:
                await require_active_trusted_session(
                    uow,
                    user_id=command.user_id,
                    session_id=pairing.candidate_session_id,
                    device_id=pairing.candidate_device_id,
                    now=now,
                )
            try:
                approved = pairing.approve(trusted_session_id=command.session_id, now=now)
            except DomainValidationError as error:
                raise translate_transition_error(error) from error
            if approved != pairing:
                await uow.device_pairings.update(approved)
            view = await build_pairing_view(uow, approved)
            await uow.commit()
            return view
