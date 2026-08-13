"""Durable QR pairing state-machine specifications."""

from datetime import UTC, datetime, timedelta

import pytest

from messenger.application.device_pairings.approve import (
    ApproveDevicePairing,
    ApproveDevicePairingCommand,
)
from messenger.application.device_pairings.authorize import (
    AuthorizeDevicePairing,
    AuthorizeDevicePairingCommand,
)
from messenger.application.device_pairings.create_offer import (
    CreatePairingOffer,
    CreatePairingOfferCommand,
)
from messenger.application.device_pairings.create_request import (
    CreatePairingRequest,
    CreatePairingRequestCommand,
)
from messenger.application.device_pairings.policy import DevicePairingPolicy
from messenger.application.device_pairings.scan import (
    ScanPairingOffer,
    ScanPairingOfferCommand,
    ScanPairingRequest,
    ScanPairingRequestCommand,
)
from messenger.application.device_pairings.status import (
    GetCandidatePairingStatus,
    GetCandidatePairingStatusQuery,
)
from messenger.application.errors import (
    DevicePairingNotFoundError,
    DevicePairingProofError,
    DevicePairingStateError,
)
from messenger.application.security_events.policy import SecurityEventPolicy
from messenger.application.sessions.policy import SessionPolicy
from messenger.domain.entities import Device, DevicePairingStatus, Session, User
from tests.application.fakes import (
    FakeIdentityUnitOfWorkFactory,
    FixedClock,
    FixedSessionCredentials,
    IdentityState,
)

NOW = datetime(2026, 8, 13, 10, 0, tzinfo=UTC)
PAIRING_POLICY = DevicePairingPolicy(
    ttl=timedelta(minutes=10),
    retention=timedelta(days=1),
)
SESSION_POLICY = SessionPolicy(
    idle_timeout=timedelta(days=30),
    absolute_lifetime=timedelta(days=90),
    rotation_interval=timedelta(days=1),
    previous_token_grace=timedelta(seconds=60),
    touch_interval=timedelta(minutes=5),
)
EVENT_POLICY = SecurityEventPolicy(retention=timedelta(days=90))
CANDIDATE_PROOF = "candidate-proof-secret-with-at-least-32-bytes"


def trusted_state() -> tuple[IdentityState, User, Device, Session]:
    credentials = FixedSessionCredentials()
    user = User.create(username="alice", display_name="Alice", now=NOW)
    device = Device.create(user_id=user.id, name="Alice phone", now=NOW)
    session = Session.create(
        user_id=user.id,
        device_id=device.id,
        token_hash=credentials.digest("trusted-session-secret"),
        now=NOW,
        idle_timeout=SESSION_POLICY.idle_timeout,
        absolute_lifetime=SESSION_POLICY.absolute_lifetime,
    )
    return (
        IdentityState(
            users={user.id: user},
            devices={device.id: device},
            sessions={session.id: session},
        ),
        user,
        device,
        session,
    )


def create_request_use_case(
    state: IdentityState,
    credentials: FixedSessionCredentials,
    now: datetime = NOW,
) -> CreatePairingRequest:
    return CreatePairingRequest(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(now),
        credentials=credentials,
        pairing_policy=PAIRING_POLICY,
    )


async def test_request_requires_trusted_approval_and_is_idempotently_authorized() -> None:
    state, user, trusted_device, trusted_session = trusted_state()
    credentials = FixedSessionCredentials()
    created = await create_request_use_case(state, credentials).execute(
        CreatePairingRequestCommand(
            candidate_proof_hash=credentials.digest(CANDIDATE_PROOF),
            candidate_device_name="MacBook PWA",
        )
    )

    pairing = state.device_pairings[created.pairing_id]
    assert pairing.status is DevicePairingStatus.CREATED
    assert created.scan_token == "opaque-session-00000000000000000001"
    assert created.scan_token not in pairing.scan_token_hash
    assert pairing.candidate_proof_hash is not None
    assert CANDIDATE_PROOF not in pairing.candidate_proof_hash
    assert not [item for item in state.sessions.values() if item.id != trusted_session.id]

    scanned = await ScanPairingRequest(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        credentials=credentials,
    ).execute(
        ScanPairingRequestCommand(
            pairing_id=created.pairing_id,
            scan_token=created.scan_token,
            user_id=user.id,
            session_id=trusted_session.id,
            device_id=trusted_device.id,
        )
    )
    assert scanned.status == "confirmation_pending"
    assert scanned.authentication_code is not None
    assert len(scanned.authentication_code) == 6
    assert scanned.trusted_device_name == "Alice phone"

    with pytest.raises(DevicePairingStateError):
        await AuthorizeDevicePairing(
            unit_of_work=FakeIdentityUnitOfWorkFactory(state),
            clock=FixedClock(NOW),
            credentials=credentials,
            policy=SESSION_POLICY,
            event_policy=EVENT_POLICY,
        ).execute(
            AuthorizeDevicePairingCommand(
                pairing_id=created.pairing_id,
                candidate_proof=CANDIDATE_PROOF,
            )
        )

    await ApproveDevicePairing(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
    ).execute(
        ApproveDevicePairingCommand(
            pairing_id=created.pairing_id,
            user_id=user.id,
            session_id=trusted_session.id,
            device_id=trusted_device.id,
        )
    )
    authorize = AuthorizeDevicePairing(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        credentials=credentials,
        policy=SESSION_POLICY,
        event_policy=EVENT_POLICY,
    )
    issued = await authorize.execute(
        AuthorizeDevicePairingCommand(
            pairing_id=created.pairing_id,
            candidate_proof=CANDIDATE_PROOF,
            client_ip="203.0.113.8",
        )
    )
    retried = await authorize.execute(
        AuthorizeDevicePairingCommand(
            pairing_id=created.pairing_id,
            candidate_proof=CANDIDATE_PROOF,
            client_ip="203.0.113.8",
        )
    )
    approved_retry = await ApproveDevicePairing(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
    ).execute(
        ApproveDevicePairingCommand(
            pairing_id=created.pairing_id,
            user_id=user.id,
            session_id=trusted_session.id,
            device_id=trusted_device.id,
        )
    )

    assert retried.session_id == issued.session_id
    assert retried.device_id == issued.device_id
    assert issued.session_credential == CANDIDATE_PROOF
    assert state.sessions[issued.session_id].current_token_hash == credentials.digest(
        CANDIDATE_PROOF
    )
    assert state.devices[issued.device_id].name == "MacBook PWA"
    assert len(state.devices) == 2
    assert len(state.sessions) == 2
    assert approved_retry.status == "authorized"
    assert state.device_pairings[created.pairing_id].status is DevicePairingStatus.AUTHORIZED


async def test_offer_binds_candidate_only_after_scan_and_rejects_other_approver() -> None:
    state, user, trusted_device, trusted_session = trusted_state()
    credentials = FixedSessionCredentials()
    created = await CreatePairingOffer(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        credentials=credentials,
        pairing_policy=PAIRING_POLICY,
    ).execute(
        CreatePairingOfferCommand(
            user_id=user.id,
            session_id=trusted_session.id,
            device_id=trusted_device.id,
        )
    )
    assert state.device_pairings[created.pairing_id].candidate_proof_hash is None

    scanned = await ScanPairingOffer(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        credentials=credentials,
    ).execute(
        ScanPairingOfferCommand(
            pairing_id=created.pairing_id,
            scan_token=created.scan_token,
            candidate_proof_hash=credentials.digest(CANDIDATE_PROOF),
            candidate_device_name="iPhone PWA",
        )
    )
    assert scanned.account_display_name == "Alice"
    assert scanned.candidate_device_name == "iPhone PWA"

    other = Device.create(user_id=user.id, name="Other", now=NOW)
    state.devices[other.id] = other
    with pytest.raises(DevicePairingNotFoundError):
        await ApproveDevicePairing(
            unit_of_work=FakeIdentityUnitOfWorkFactory(state),
            clock=FixedClock(NOW),
        ).execute(
            ApproveDevicePairingCommand(
                pairing_id=created.pairing_id,
                user_id=user.id,
                session_id=trusted_session.id,
                device_id=other.id,
            )
        )


async def test_wrong_proof_and_expired_pairing_fail_closed() -> None:
    state, _, _, _ = trusted_state()
    credentials = FixedSessionCredentials()
    created = await create_request_use_case(state, credentials).execute(
        CreatePairingRequestCommand(
            candidate_proof_hash=credentials.digest(CANDIDATE_PROOF),
            candidate_device_name="MacBook PWA",
        )
    )
    status = GetCandidatePairingStatus(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW),
        credentials=credentials,
    )
    with pytest.raises(DevicePairingProofError):
        await status.execute(
            GetCandidatePairingStatusQuery(
                pairing_id=created.pairing_id,
                candidate_proof="wrong-proof-secret-with-at-least-32-bytes",
            )
        )

    expired = await GetCandidatePairingStatus(
        unit_of_work=FakeIdentityUnitOfWorkFactory(state),
        clock=FixedClock(NOW + PAIRING_POLICY.ttl),
        credentials=credentials,
    ).execute(
        GetCandidatePairingStatusQuery(
            pairing_id=created.pairing_id,
            candidate_proof=CANDIDATE_PROOF,
        )
    )
    assert expired.status == "expired"
    assert state.device_pairings[created.pairing_id].status is DevicePairingStatus.EXPIRED
