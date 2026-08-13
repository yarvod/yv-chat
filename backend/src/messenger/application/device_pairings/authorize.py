"""Exchange an approved candidate proof for one independent opaque session."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from messenger.application.device_pairings.common import (
    load_pairing_for_update,
    translate_transition_error,
    verify_candidate_proof,
)
from messenger.application.errors import DevicePairingStateError
from messenger.application.ports.clock import Clock
from messenger.application.ports.identity import IdentityUnitOfWorkFactory
from messenger.application.ports.session_credentials import SessionCredentialService
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.policy import SessionPolicy
from messenger.domain.entities import (
    Device,
    DevicePairingStatus,
    SecurityEvent,
    SecurityEventType,
    Session,
)
from messenger.domain.exceptions import DomainValidationError


@dataclass(frozen=True, slots=True)
class AuthorizeDevicePairingCommand:
    pairing_id: UUID
    candidate_proof: str
    client_ip: str | None = None


@dataclass(frozen=True, slots=True)
class AuthorizeDevicePairingResult:
    user_id: UUID
    session_id: UUID
    device_id: UUID
    session_credential: str
    absolute_expires_at: datetime


class AuthorizeDevicePairing:
    def __init__(
        self,
        *,
        unit_of_work: IdentityUnitOfWorkFactory,
        clock: Clock,
        credentials: SessionCredentialService,
        policy: SessionPolicy,
        event_policy: SecurityEventPolicy,
    ) -> None:
        self._unit_of_work = unit_of_work
        self._clock = clock
        self._credentials = credentials
        self._policy = policy
        self._event_policy = event_policy

    async def execute(self, command: AuthorizeDevicePairingCommand) -> AuthorizeDevicePairingResult:
        now = self._clock.now()
        async with self._unit_of_work() as uow:
            pairing = await load_pairing_for_update(uow, command.pairing_id, now)
            verify_candidate_proof(pairing, command.candidate_proof, self._credentials)
            if pairing.user_id is None or pairing.candidate_device_name is None:
                raise DevicePairingStateError("pairing is not bound")
            user = await uow.users.get_by_id(pairing.user_id, for_update=True)
            if user is None or not user.is_active:
                raise DevicePairingStateError("pairing account is inactive")

            if pairing.status is DevicePairingStatus.AUTHORIZED:
                if pairing.authorized_session_id is None or pairing.authorized_device_id is None:
                    raise DevicePairingStateError("authorized pairing is incomplete")
                session = await uow.sessions.get_by_id(pairing.authorized_session_id)
                device = await uow.devices.get_by_id(pairing.authorized_device_id)
                if (
                    session is None
                    or device is None
                    or session.revoked_at is not None
                    or device.revoked_at is not None
                    or session.is_expired(now)
                ):
                    raise DevicePairingStateError("issued pairing session is inactive")
            else:
                if pairing.status is not DevicePairingStatus.APPROVED:
                    raise DevicePairingStateError("pairing is not approved")
                digest = self._credentials.digest(command.candidate_proof)
                if await uow.sessions.get_by_token_hash_for_update(digest) is not None:
                    raise DevicePairingStateError("candidate proof is already a session")
                device = Device.create(
                    user_id=pairing.user_id,
                    name=pairing.candidate_device_name,
                    now=now,
                    client_ip=command.client_ip,
                )
                session = Session.create(
                    user_id=pairing.user_id,
                    device_id=device.id,
                    token_hash=digest,
                    now=now,
                    idle_timeout=self._policy.idle_timeout,
                    absolute_lifetime=self._policy.absolute_lifetime,
                )
                try:
                    authorized = pairing.authorize(
                        device_id=device.id,
                        session_id=session.id,
                        now=now,
                    )
                except DomainValidationError as error:
                    raise translate_transition_error(error) from error
                await uow.devices.add(device)
                await uow.sessions.add(session)
                await uow.device_pairings.update(authorized)
                await uow.security_events.prune_expired(now)
                await uow.security_events.add(
                    SecurityEvent.create(
                        user_id=session.user_id,
                        event_type=SecurityEventType.LOGIN,
                        now=now,
                        retention=self._event_policy.retention,
                        actor_session_id=pairing.trusted_session_id,
                        target_device_id=device.id,
                    )
                )
            await uow.commit()
        return AuthorizeDevicePairingResult(
            user_id=session.user_id,
            session_id=session.id,
            device_id=device.id,
            session_credential=command.candidate_proof,
            absolute_expires_at=session.absolute_expires_at,
        )
