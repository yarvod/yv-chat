"""Create a trusted-computer pairing offer for a candidate phone."""

from dataclasses import dataclass
from uuid import UUID

from messenger.application.device_pairings.common import require_active_trusted_session
from messenger.application.device_pairings.create_request import CreatePairingResult
from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.domain.entities import DevicePairing


@dataclass(frozen=True, slots=True)
class CreatePairingOfferCommand:
    user_id: UUID
    session_id: UUID
    device_id: UUID


class CreatePairingOffer:
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

    async def execute(self, command: CreatePairingOfferCommand) -> CreatePairingResult:
        now = self._clock.now()
        scan_token = self._credentials.generate()
        pairing = DevicePairing.create_offer(
            scan_token_hash=scan_token.digest,
            user_id=command.user_id,
            trusted_session_id=command.session_id,
            trusted_device_id=command.device_id,
            now=now,
            expires_at=now + self._policy.ttl,
        )
        async with self._unit_of_work() as uow:
            await require_active_trusted_session(
                uow,
                user_id=command.user_id,
                session_id=command.session_id,
                device_id=command.device_id,
                now=now,
            )
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
