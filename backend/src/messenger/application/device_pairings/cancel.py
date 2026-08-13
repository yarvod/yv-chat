"""Cancel an unfinished pairing from either bound side."""

from dataclasses import dataclass
from datetime import datetime
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
from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.errors import DevicePairingNotFoundError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.domain.entities import DevicePairing, DevicePairingStatus
from messenger.domain.exceptions import DomainValidationError


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


@dataclass(frozen=True, slots=True)
class CancelDeviceHistorySyncCommand:
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


class CancelDeviceHistorySync:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        pairing_policy: DevicePairingPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._policy = pairing_policy

    async def execute(self, command: CancelDeviceHistorySyncCommand) -> None:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            preview = await uow.device_pairings.get_by_id(command.pairing_id)
            _require_history_actor(preview, command=command, now=now, policy=self._policy)
            assert preview is not None
            assert preview.trusted_device_id is not None
            assert preview.authorized_device_id is not None
            await uow.device_pairings.lock_history_pair(
                user_id=command.user_id,
                first_device_id=preview.trusted_device_id,
                second_device_id=preview.authorized_device_id,
            )
            await require_active_trusted_session(
                uow,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
                now=now,
            )
            pairing = await uow.device_pairings.get_by_id_for_update(command.pairing_id)
            _require_history_actor(pairing, command=command, now=now, policy=self._policy)
            assert pairing is not None
            try:
                cancelled = pairing.cancel_history_sync(now=now)
            except DomainValidationError as error:
                raise DevicePairingNotFoundError("pairing not found") from error
            if cancelled != pairing:
                await uow.device_pairings.update(cancelled)
            await uow.commit()


def _require_history_actor(
    pairing: DevicePairing | None,
    *,
    command: CancelDeviceHistorySyncCommand,
    now: datetime,
    policy: DevicePairingPolicy,
) -> None:
    if (
        pairing is None
        or pairing.status is not DevicePairingStatus.AUTHORIZED
        or pairing.user_id != command.user_id
        or now >= pairing.expires_at + policy.retention
        or pairing.trusted_device_id is None
        or pairing.authorized_device_id is None
    ):
        raise DevicePairingNotFoundError("pairing not found")
    trusted_actor = (
        pairing.trusted_session_id == command.session_id
        and pairing.trusted_device_id == command.device_id
    )
    authorized_actor = (
        pairing.authorized_session_id == command.session_id
        and pairing.authorized_device_id == command.device_id
    )
    if not trusted_actor and not authorized_actor:
        raise DevicePairingNotFoundError("pairing not found")
