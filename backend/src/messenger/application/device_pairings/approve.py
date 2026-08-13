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
from messenger.application.errors import DevicePairingNotFoundError, DevicePairingStateError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.domain.entities import DevicePairingStatus
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
            preview = await uow.device_pairings.get_by_id(command.pairing_id)
            if preview is None:
                raise DevicePairingNotFoundError("pairing not found")
            require_trusted_actor(
                preview,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
            )
            if preview.candidate_session_id is not None and preview.candidate_device_id is not None:
                assert preview.user_id is not None
                assert preview.trusted_device_id is not None
                await uow.device_pairings.lock_history_pair(
                    user_id=preview.user_id,
                    first_device_id=preview.trusted_device_id,
                    second_device_id=preview.candidate_device_id,
                )
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
                if (
                    pairing.user_id != preview.user_id
                    or pairing.trusted_device_id != preview.trusted_device_id
                    or pairing.candidate_device_id != preview.candidate_device_id
                ):
                    raise DevicePairingStateError("pairing binding changed")
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
                if (
                    approved.status is DevicePairingStatus.AUTHORIZED
                    and approved.user_id is not None
                    and approved.trusted_device_id is not None
                    and approved.authorized_device_id is not None
                ):
                    await uow.device_pairings.cancel_other_active_history_syncs(
                        pairing_id=approved.id,
                        user_id=approved.user_id,
                        first_device_id=approved.trusted_device_id,
                        second_device_id=approved.authorized_device_id,
                        now=now,
                    )
                await uow.device_pairings.update(approved)
            view = await build_pairing_view(uow, approved)
            await uow.commit()
            return view
