"""Create an anonymous candidate-computer pairing request."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.domain.entities import DevicePairing


@dataclass(frozen=True, slots=True)
class CreatePairingRequestCommand:
    candidate_proof_hash: str
    candidate_device_name: str


@dataclass(frozen=True, slots=True)
class CreatePairingResult:
    pairing_id: UUID
    protocol_version: int
    purpose: str
    scan_token: str
    expires_at: datetime


class CreatePairingRequest:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        credentials: SessionCredentialService,
        pairing_policy: DevicePairingPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._credentials = credentials
        self._policy = pairing_policy

    async def execute(self, command: CreatePairingRequestCommand) -> CreatePairingResult:
        now = self._clock.now()
        scan_token = self._credentials.generate()
        pairing = DevicePairing.create_request(
            scan_token_hash=scan_token.digest,
            candidate_proof_hash=command.candidate_proof_hash,
            candidate_device_name=command.candidate_device_name,
            now=now,
            expires_at=now + self._policy.ttl,
        )
        async with self._unit_of_work() as uow:
            await uow.device_pairings.prune_expired(before=now - self._policy.retention)
            await uow.device_pairings.add(pairing)
            await uow.commit()
        return CreatePairingResult(
            pairing_id=pairing.id,
            protocol_version=pairing.protocol_version,
            purpose=pairing.purpose.value,
            scan_token=scan_token.plaintext,
            expires_at=pairing.expires_at,
        )
