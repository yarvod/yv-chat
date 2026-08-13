"""Bind both halves of a QR pairing after presenting the scan capability."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_pairings.common import (
    DevicePairingView,
    build_pairing_view,
    load_pairing_for_update,
    require_active_trusted_session,
    translate_transition_error,
    verify_scan_token,
)
from messenger.application.errors import DevicePairingNotFoundError, DevicePairingStateError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.domain.entities import DevicePairingStatus
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class ScanPairingRequestCommand:
    pairing_id: UUID
    scan_token: str
    user_id: UUID
    session_id: UUID
    device_id: UUID


@dataclass(frozen=True, slots=True)
class ScanPairingOfferCommand:
    pairing_id: UUID
    scan_token: str
    candidate_proof_hash: str
    candidate_device_name: str


@dataclass(frozen=True, slots=True)
class ScanExistingPairingOfferCommand:
    pairing_id: UUID
    scan_token: str
    user_id: UUID
    session_id: UUID
    device_id: UUID


class ScanPairingRequest:
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

    async def execute(self, command: ScanPairingRequestCommand) -> DevicePairingView:
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
            verify_scan_token(pairing, command.scan_token, self._credentials)
            if pairing.status is DevicePairingStatus.CONFIRMATION_PENDING:
                if (
                    pairing.user_id != command.user_id
                    or pairing.trusted_session_id != command.session_id
                    or pairing.trusted_device_id != command.device_id
                ):
                    raise DevicePairingStateError("pairing already scanned")
            else:
                try:
                    pairing = pairing.scan_request(
                        user_id=command.user_id,
                        trusted_session_id=command.session_id,
                        trusted_device_id=command.device_id,
                        now=now,
                    )
                except DomainValidationError as error:
                    raise translate_transition_error(error) from error
                await uow.device_pairings.update(pairing)
            view = await build_pairing_view(uow, pairing)
            await uow.commit()
            return view


class ScanPairingOffer:
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

    async def execute(self, command: ScanPairingOfferCommand) -> DevicePairingView:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            pairing = await load_pairing_for_update(uow, command.pairing_id, now)
            verify_scan_token(pairing, command.scan_token, self._credentials)
            if pairing.status is DevicePairingStatus.CONFIRMATION_PENDING:
                if (
                    pairing.candidate_proof_hash != command.candidate_proof_hash
                    or pairing.candidate_device_name != command.candidate_device_name.strip()
                ):
                    raise DevicePairingStateError("pairing already scanned")
            else:
                try:
                    pairing = pairing.scan_offer(
                        candidate_proof_hash=command.candidate_proof_hash,
                        candidate_device_name=command.candidate_device_name,
                        now=now,
                    )
                except DomainValidationError as error:
                    raise translate_transition_error(error) from error
                await uow.device_pairings.update(pairing)
            view = await build_pairing_view(uow, pairing)
            await uow.commit()
            return view


class ScanExistingPairingOffer:
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

    async def execute(self, command: ScanExistingPairingOfferCommand) -> DevicePairingView:
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
            verify_scan_token(pairing, command.scan_token, self._credentials)
            if pairing.user_id != command.user_id:
                raise DevicePairingNotFoundError("pairing not found")
            if pairing.trusted_device_id == command.device_id:
                raise DevicePairingStateError("pairing requires two different devices")
            if pairing.status is DevicePairingStatus.CONFIRMATION_PENDING:
                if (
                    pairing.candidate_session_id != command.session_id
                    or pairing.candidate_device_id != command.device_id
                ):
                    raise DevicePairingStateError("pairing already scanned")
            else:
                try:
                    pairing = pairing.scan_existing_offer(
                        candidate_session_id=command.session_id,
                        candidate_device_id=command.device_id,
                        now=now,
                    )
                except DomainValidationError as error:
                    raise translate_transition_error(error) from error
                await uow.device_pairings.update(pairing)
            view = await build_pairing_view(uow, pairing)
            await uow.commit()
            return view
